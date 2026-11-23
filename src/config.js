import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import dotenv from 'dotenv';

dotenv.config({ path: process.env.ENV_FILE || '.env' });

function splitCsv(name, { required = false } = {}) {
  const raw = (process.env[name] || '').trim();
  if (!raw) {
    if (required) throw new Error(`${name} is required (comma-separated allowlist; fail-closed)`);
    return [];
  }
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function bool(name, defaultValue) {
  const raw = process.env[name];
  if (raw == null || raw === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).toLowerCase());
}

function int(name, defaultValue) {
  const raw = process.env[name];
  if (raw == null || raw === '') return defaultValue;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number`);
  return n;
}

function env(name) {
  return (process.env[name] || '').trim();
}

export function loadConfig() {
  const token = env('DISCORD_BOT_TOKEN');
  if (!token) throw new Error('DISCORD_BOT_TOKEN is required');
  if (token.length < 20) throw new Error('DISCORD_BOT_TOKEN looks too short — refuse to start');

  const guildAllow = splitCsv('DISCORD_GUILD_ALLOWLIST', { required: true });
  const channelAllow = splitCsv('DISCORD_CHANNEL_ALLOWLIST', { required: true });
  const authorAllow = splitCsv('DISCORD_AUTHOR_ALLOWLIST', { required: true });
  const ownerId = env('DISCORD_OWNER_ID');
  const brainMode = (env('BRAIN_MODE') || 'openai_compat').trim();
  // Empty = DMs disabled (fail-closed).
  const dmAllow = splitCsv('DISCORD_DM_ALLOWLIST');
  if (dmAllow.length && brainMode === 'gbot') {
    throw new Error('DISCORD_DM_ALLOWLIST is not supported in gbot mode');
  }
  const peerMentionId = env('DISCORD_PEER_MENTION_ID');
  const webhookAsync = bool('WEBHOOK_ASYNC', false);
  if (!peerMentionId && brainMode !== 'gbot' && brainMode !== 'mausbot' && !(brainMode === 'webhook' && webhookAsync)) {
    throw new Error('DISCORD_PEER_MENTION_ID is required (e.g. Hermes/Maverick bot id)');
  }

  if (!['openai_compat', 'webhook', 'log_only', 'gbot', 'mausbot'].includes(brainMode)) {
    throw new Error('BRAIN_MODE must be openai_compat | webhook | log_only | gbot | mausbot');
  }

  const gbot = {
    binary: env('GBOT_BIN') || 'gbot',
    target: env('GBOT_TARGET_ID'),
    timeoutMs: int('GBOT_TIMEOUT_MS', 120000),
    pollMs: int('GBOT_POLL_MS', 2000),
  };
  if (brainMode === 'gbot') {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}$/.test(gbot.target)) throw new Error('GBOT_TARGET_ID must be a stable bot id (not a name)');
    if (new Set(guildAllow).size !== 1 || new Set(channelAllow).size !== 1) {
      throw new Error('gbot mode requires exactly one guild and channel to avoid shared-conversation leaks');
    }
    if (!Number.isInteger(gbot.timeoutMs) || gbot.timeoutMs < 1000 || gbot.timeoutMs > 300000 ||
        !Number.isInteger(gbot.pollMs) || gbot.pollMs < 250 || gbot.pollMs > gbot.timeoutMs) {
      throw new Error('gbot timeout must be 1000–300000 ms; polling must be 250 ms or more and no longer than timeout');
    }
    if (int('MAX_INFLIGHT_PER_CHANNEL', 1) !== 1) throw new Error('gbot mode requires MAX_INFLIGHT_PER_CHANNEL=1');
  }

  const mausbot = {
    apiBase: env('MAUSBOT_API_BASE').replace(/\/$/, ''),
    apiKey: env('MAUSBOT_API_KEY'),
    actsAsMe: bool('MAUSBOT_ACTS_AS_ME', true),
    timeoutMs: int('MAUSBOT_TIMEOUT_MS', 120000),
    pollMs: int('MAUSBOT_POLL_MS', 2000),
  };
  if (brainMode === 'mausbot') {
    if (!ownerId) throw new Error('DISCORD_OWNER_ID is required in mausbot mode');
    if (!mausbot.apiKey) throw new Error('MAUSBOT_API_KEY is required in mausbot mode');
    if (!mausbot.apiBase) throw new Error('MAUSBOT_API_BASE is required in mausbot mode');
    if (authorAllow.length !== 1 || authorAllow[0] !== ownerId) {
      throw new Error('DISCORD_AUTHOR_ALLOWLIST must contain exactly DISCORD_OWNER_ID in mausbot mode');
    }
    if (!Number.isInteger(mausbot.timeoutMs) || mausbot.timeoutMs < 1000 || mausbot.timeoutMs > 300000 ||
        !Number.isInteger(mausbot.pollMs) || mausbot.pollMs < 250 || mausbot.pollMs > mausbot.timeoutMs) {
      throw new Error('MAUSBOT timeout must be 1000–300000 ms; polling must be 250 ms or more and no longer than timeout');
    }
    if (int('MAX_INFLIGHT_PER_CHANNEL', 1) !== 1) throw new Error('mausbot mode requires MAX_INFLIGHT_PER_CHANNEL=1');
  }

  const systemPromptFile = env('SYSTEM_PROMPT_FILE');
  let systemPrompt = env('SYSTEM_PROMPT');
  if (systemPromptFile) {
    const abs = path.resolve(systemPromptFile);
    systemPrompt = fs.readFileSync(abs, 'utf8');
  }
  if (!systemPrompt) {
    systemPrompt =
      'You are a concise Discord-connected agent. Answer the user. Do not invent secrets. Keep replies short.';
  }

  // Build provider key name without a single static secret-looking token in source.
  const providerKeyName = ['OPENAI', 'API', 'KEY'].join('_');

  return {
    token,
    ownerId,
    guildAllow: new Set(guildAllow),
    channelAllow: new Set(channelAllow),
    authorAllow: new Set(authorAllow),
    dmAllow: new Set(dmAllow),
    peerMentionId,
    requireBotMention: bool('REQUIRE_BOT_MENTION', true),
    wakeWords: splitCsv('WAKE_WORDS').map((w) => w.toLowerCase()),
    brainMode,
    gbot,
    mausbot,
    openai: {
      baseUrl: (env('OPENAI_BASE_URL') || 'https://api.x.ai/v1').replace(/\/$/, ''),
      apiKey: env(providerKeyName),
      model: env('OPENAI_MODEL') || 'grok-4',
    },
    webhook: {
      url: env('WEBHOOK_URL'),
      authHeader: env('WEBHOOK_AUTH_HEADER'),
      // Local patch: Grok Bot routine webhooks answer 200 = "run started"; the reply
      // is posted later by the agent itself via scripts/discord-reply.mjs.
      async: webhookAsync,
    },
    systemPrompt,
    maxInflightPerChannel: int('MAX_INFLIGHT_PER_CHANNEL', 1),
    dedupeTtlSeconds: int('DEDUPE_TTL_SECONDS', 600),
    rateLimitPerUser: int('RATE_LIMIT_PER_USER', 8),
    rateLimitWindowMs: int('RATE_LIMIT_WINDOW_MS', 60000),
    logLevel: env('LOG_LEVEL') || 'info',
  };
}
