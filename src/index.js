#!/usr/bin/env node
/**
 * grok-bot-discord — thin Discord Gateway bridge (v0.3)
 *
 * Purpose: hold a live Discord Gateway socket for a bot identity used by
 * Grok Bot (or any external brain), so the bot is online and can receive
 * @mentions. Designed to run on the Grok Bot computer — NOT as a Hermes profile.
 *
 * CRITICAL DESIGN RULES
 * 1. Fail-closed allowlists (guild / channel / author)
 * 2. Do NOT drop messages solely because author.bot === true
 *    (that is the classic bug that blocks Hermes/Maverick → Grok Bot traffic)
 * 3. Ignore self messages
 * 4. Require @mention (or wake word) to avoid free-response spam
 * 5. Legacy backends append a peer mention; gbot replies never auto-handoff
 * 6. Never log tokens
 * 7. Split long replies; rate-limit per author
 */

import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
} from 'discord.js';
import { loadConfig } from './config.js';
import { think } from './brain.js';
import { splitMessage } from './splitMessage.js';
import { RateLimiter } from './rateLimit.js';
import { isAllowedInGuild, formatReplyText, neutralizeMentions } from './handlerPure.js';
import { isAllowedDm } from './dm.js';
import { startTypingPulse } from './typing.js';
import { watchLateReply } from './lateReply.js';
import { createSendApi } from './sendApi.js';

const cfg = loadConfig();
const limiter = new RateLimiter(cfg.rateLimitPerUser, cfg.rateLimitWindowMs);

function log(level, msg, extra) {
  const levels = { error: 0, warn: 1, info: 2, debug: 3 };
  if ((levels[level] ?? 9) > (levels[cfg.logLevel] ?? 2)) return;
  const line = extra ? `${msg} ${JSON.stringify(extra)}` : msg;
  // eslint-disable-next-line no-console
  console[level === 'debug' ? 'log' : level](`[mausbot-discord-bridge] ${line}`);
}

const seen = new Map(); // messageId -> expiresAt
const inflight = new Map(); // channelId -> count

function pruneSeen(now = Date.now()) {
  for (const [id, exp] of seen) {
    if (exp <= now) seen.delete(id);
  }
}

function alreadyHandled(messageId) {
  pruneSeen();
  if (seen.has(messageId)) return true;
  seen.set(messageId, Date.now() + cfg.dedupeTtlSeconds * 1000);
  return false;
}

function mentionsBot(message, clientUser) {
  if (message.mentions?.users?.has(clientUser.id)) return true;
  if (message.content?.includes(`<@${clientUser.id}>`)) return true;
  if (message.content?.includes(`<@!${clientUser.id}>`)) return true;
  return false;
}

function hasWakeWord(content) {
  if (!cfg.wakeWords.length) return false;
  const lower = content.toLowerCase();
  return cfg.wakeWords.some((w) => w && lower.includes(w));
}

function stripBotMention(content, botId) {
  return content
    .replace(new RegExp(`<@!?${botId}>`, 'g'), '')
    .trim();
}

async function sendSplitReply(message, fullText, handoff = true) {
  // Peer gateways may inspect literal mention syntax even without Discord notifications.
  // Keep allowlisted pings intact; neutralize every other raw user mention.
  const allow = cfg.mentionAllow || new Set();
  if (!handoff) {
    fullText = neutralizeMentions(fullText, allow);
  }
  const chunks = splitMessage(fullText, 1900);
  const users = handoff ? [cfg.peerMentionId].filter(Boolean) : [...allow];
  const opts = {
    allowedMentions: {
      parse: [],
      users,
      repliedUser: false,
    },
  };
  // First chunk as reply (fall back to channel.send if the original message was deleted); rest as follow-ups.
  try {
    await message.reply({ content: chunks[0], ...opts });
  } catch {
    await message.channel.send({ content: chunks[0], ...opts });
  }
  for (let i = 1; i < chunks.length; i++) {
    await message.channel.send({ content: chunks[i], ...opts });
  }
}

let sendServer; // loopback send API, owned by the bridge

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

client.once(Events.ClientReady, (c) => {
  log('info', `online as ${c.user.tag}`, { id: c.user.id, version: '0.1.0' });
  log('info', 'allowlists loaded', {
    guilds: [...cfg.guildAllow],
    channels: [...cfg.channelAllow],
    dmAuthors: [...(cfg.dmAllow || [])],
    authors: [...cfg.authorAllow],
    peerAuthors: [...(cfg.peerAuthorAllow || [])],
    requireBotMention: cfg.requireBotMention,
    brainMode: cfg.brainMode,
  });
  sendServer = createSendApi(cfg, client, log);
});

// Connection health logging so outages are visible in bridge.log.
client.on(Events.ShardDisconnect, (ev, id) => log('warn', 'shard disconnect', { shard: id, code: ev?.code }));
client.on(Events.ShardReconnecting, (id) => log('warn', 'shard reconnecting', { shard: id }));
client.on(Events.ShardResume, (id, replayed) => log('info', 'shard resumed', { shard: id, replayed }));
client.on(Events.ShardError, (err, id) => log('error', 'shard error', { shard: id, err: String(err?.message || err) }));
client.on(Events.Error, (err) => log('error', 'client error', { err: String(err?.message || err) }));
client.on(Events.Warn, (msg) => log('warn', 'client warn', { msg: String(msg) }));

client.on(Events.MessageCreate, async (message) => {
  let acquiredChannel;
  try {
    // Ignore self always
    if (message.author.id === client.user.id) return;

    // DMs: fail-closed. Only non-bot humans on BOTH the author and DM allowlists.
    const isDM = !message.guild;
    if (isDM) {
      if (!cfg.dmAllow?.size) return; // DMs disabled
      if (message.author.bot) return;
      if (!cfg.dmAllow.has(message.author.id) || !cfg.authorAllow.has(message.author.id)) {
        log('debug', 'drop non-allowlisted DM', { author: message.author.id });
        return;
      }
      // A group DM also has no guild. Without this check, private replies could
      // leak to anyone else in the group as long as one author was allowlisted.
      const dmChannel = message.channel?.partial && typeof message.channel.fetch === 'function'
        ? await message.channel.fetch().catch(() => null)
        : message.channel;
      if (!isAllowedDm(dmChannel, cfg.dmAllow, client.user.id)) {
        log('debug', 'drop non-1:1 DM channel', { author: message.author.id, channelType: dmChannel?.type });
        return;
      }
    } else {
      if (!isAllowedInGuild(message, cfg, client.user.id)) return;
    }

    // CRITICAL: do NOT drop all bots. Only accept allowlisted authors
    // (humans and peer agent bots such as Hermes/Maverick).
    if (!cfg.authorAllow.has(message.author.id)) {
      log('debug', 'drop non-allowlisted author', {
        author: message.author.id,
        bot: message.author.bot,
      });
      return;
    }

    const mentioned = mentionsBot(message, client.user);
    const wake = hasWakeWord(message.content || '');
    if (!isDM && (cfg.requireBotMention || message.author.bot) && !mentioned && !wake) return;

    pruneSeen();
    if (seen.has(message.id)) return;

    if (!limiter.allow(message.author.id)) {
      log('warn', 'rate limited', { author: message.author.id });
      return;
    }

    const channelId = message.channel.id;
    const current = inflight.get(channelId) || 0;
    if (current >= cfg.maxInflightPerChannel) {
      log('warn', 'channel busy; drop', { channelId });
      if (!message.author.bot) {
        await message.reply({ content: 'The bridge is waiting for a reply. This message was not sent; try again when it finishes.', allowedMentions: { parse: [], repliedUser: false } });
      }
      return;
    }
    alreadyHandled(message.id);
    inflight.set(channelId, current + 1);
    acquiredChannel = channelId;

    const text = stripBotMention(message.content || '', client.user.id);
    if (!text) {
      return;
    }

    log('info', 'wake', {
      author: message.author.id,
      bot: message.author.bot,
      dm: isDM,
      messageId: message.id,
    });

    await message.channel.sendTyping().catch(() => {});
    // Discord's typing state expires in a few seconds. Keep refreshing it while
    // the brain runs so a long turn is visibly "still working", not a timeout.
    const stopTyping = startTypingPulse(message.channel, cfg.typingPulseMs);
    let result;
    try {
      result = await think(cfg, {
        text,
        authorId: message.author.id,
        authorTag: message.author.tag,
        isBot: Boolean(message.author.bot),
        channelId: message.channel.id,
        guildId: isDM ? null : message.guild.id,
        isDM,
        messageId: message.id,
      });
    } finally {
      stopTyping();
    }

    if (result.silent) {
      // Async webhook brain: acknowledge with a reaction; the agent replies later.
      await message.react('👀').catch(() => {});
      return;
    }

    const reply = formatReplyText(result, cfg);

    await sendSplitReply(message, reply, result.handoff !== false);

    if (result.pending) {
      const heldChannel = acquiredChannel;
      const releaseSlot = () => {
        if (!heldChannel) return;
        const n = inflight.get(heldChannel) || 1;
        inflight.set(heldChannel, Math.max(0, n - 1));
      };
      const watching = watchLateReply(cfg, {
        threadKey: result.threadKey,
        requestId: result.requestId,
        format: (content) => formatReplyText({ text: content, handoff: false }, cfg),
        send: (text) => sendSplitReply(message, text, false),
        log,
        onFinish: releaseSlot,
      });
      if (watching) {
        // Keep the channel busy until the background watcher finishes so a new
        // message cannot POST concurrently to the same MausBot thread.
        acquiredChannel = null;
      }
    }
  } catch (err) {
    log('error', 'handler failed', { messageId: message.id, type: err?.name || 'Error' });
    try {
      await message.reply({
        content: 'The bridge could not finish this reply. Check the bridge host and MausBot conversation before resending.',
        allowedMentions: { parse: [], repliedUser: false },
      });
    } catch {
      /* ignore */
    }
  } finally {
    const channelId = acquiredChannel;
    if (channelId) {
      const n = inflight.get(channelId) || 1;
      inflight.set(channelId, Math.max(0, n - 1));
    }
  }
});

client.login(cfg.token).catch((err) => {
  log('error', 'login failed', { err: String(err?.message || err) });
  process.exit(1);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    log('info', `shutdown ${sig}`);
    if (sendServer) sendServer.close();
    client.destroy();
    process.exit(0);
  });
}
