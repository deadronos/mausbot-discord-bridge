import { execFile } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

// Deliberately use the public CLI, not Grok's private gateway/auth implementation.
export function runGbot(binary, args, timeoutMs) {
  const env = { ...process.env, GROK_BOT_HISTORY: 'off' };
  // A bridge launched from a Codex terminal must not inherit its return route.
  delete env.CODEX_THREAD_ID;
  delete env.DISCORD_BOT_TOKEN;
  delete env.OPENAI_API_KEY;
  delete env.WEBHOOK_AUTH_HEADER;
  return new Promise((resolve, reject) => {
    execFile(binary, args, {
      env, timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 2 * 1024 * 1024,
      encoding: 'utf8', shell: false,
    }, (error, stdout) => {
      // Neither stderr nor raw subprocess errors are safe to relay to Discord.
      if (error) return reject(new Error('gbot command failed'));
      resolve(stdout);
    });
  });
}

function json(text) {
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid gbot response');
  return data;
}

function notice(text) {
  return { text, handoff: false };
}

/** Wait for a visible, request-correlated reply, not an inferred task completion. */
export async function thinkGbot(cfg, payload, deps = {}) {
  const run = deps.run || runGbot;
  const sleep = deps.sleep || delay;
  const now = deps.now || Date.now;
  const { binary, target, timeoutMs, pollMs } = cfg.gbot;
  const deadline = now() + timeoutMs;
  const command = (args) => {
    const remaining = deadline - now();
    if (remaining <= 0) throw new Error('Observation deadline reached');
    return run(binary, args, Math.min(remaining, 30_000));
  };

  try {
    // Pin the parsed receipt/transcript contract; upgrade deliberately.
    const version = (await command(['--version'])).trim();
    if (!/^(?:gbot |grok-bot-cli )?v?0\.12\.0$/.test(version)) {
      return notice('Grok bridge needs grok-bot-cli 0.12.0. No message was sent.');
    }
  } catch {
    return notice('Grok CLI is unavailable. No message was sent. Check the bridge host configuration.');
  }

  try {
    const probe = json(await command(['thread', target, '--json', '--gateway', '--no-history', '--limit', '1']));
    if (probe.target?.id !== target || probe.target.isGroup !== false || !Array.isArray(probe.transcript?.entries)) {
      return notice('The configured Grok target is not a supported individual bot. No message was sent.');
    }
  } catch {
    return notice('The configured Grok Bot is unavailable. No message was sent. Check its access in the app.');
  }

  // Prefix makes the positional prompt unambiguous even if user input starts "--".
  // Routing comes only from trusted configuration, never from the Discord message.
  const prompt = `[Discord message ${payload.messageId}; author ${payload.authorId}; channel ${payload.channelId}]\n${payload.text}`;
  let receipt;
  try {
    receipt = json(await command([
      'send', '--json', '--gateway', '--no-history', '--reply-mode', 'manual', target, prompt,
    ]));
  } catch {
    return notice('Grok delivery is unconfirmed. Check the Grok Bot conversation before sending again; the bridge will not retry.');
  }
  if (receipt.delivery === 'rejected') return notice('Grok rejected the message. Check the Grok Bot app for access or usage issues.');
  if (receipt.delivery !== 'accepted' || receipt.exitCode !== 0 ||
      typeof receipt.messageId !== 'string' || !receipt.messageId ||
      receipt.id !== target || receipt.kind !== 'bot') {
    return notice('Grok delivery is unconfirmed. Check the Grok Bot conversation before sending again; the bridge will not retry.');
  }

  let requestId;
  while (now() < deadline) {
    let page;
    try {
      // Scan the bounded page again: a streaming entry can change without its ID changing.
      page = json(await command(['thread', target, '--json', '--gateway', '--no-history', '--limit', '200']));
    } catch {
      return notice('Grok accepted the message, but the bridge could not read its reply. Continue in the Grok Bot app; do not resend automatically.');
    }
    const entries = page.transcript?.entries;
    if (page.target?.id !== target || !Array.isArray(entries) || entries.length > 200) {
      return notice('Grok accepted the message, but its reply format changed. Check the Grok Bot app.');
    }
    const source = entries.find((e) => e?.id === receipt.messageId && e.kind === 'message');
    if (source && typeof source.requestId === 'string' && source.requestId) {
      if (requestId && requestId !== source.requestId) {
        return notice('Grok accepted the message, but reply correlation changed. Check the Grok Bot app.');
      }
      requestId = source.requestId;
    }
    if (requestId) {
      const replies = entries.filter((e) => e?.kind === 'send-message' && e.requestId === requestId);
      // Approval card contents can contain commands/secrets. Keep approval in the owning UI.
      if (replies.some((e) => ['auto-review-approval', 'local-tool-permission'].includes(e.message?.type))) {
        return notice('Grok needs your approval. Open the Grok Bot app to review it. This bridge does not approve actions.');
      }
      const text = replies.filter((e) => e.message?.type === 'text' && typeof e.message.content === 'string')
        .map((e) => e.message.content.trim()).filter(Boolean).join('\n\n');
      if (text) return notice(`**Grok reply — work may continue in the app:**\n\n${text.slice(0, 12_000)}${text.length > 12_000 ? '\n\n[Long reply shortened; full text is in Grok Bot.]' : ''}`);
    }
    // A full page without the source cannot establish coverage. Never guess by recency.
    if (!requestId && entries.length === 200 && !source) {
      return notice('Grok accepted the message, but its request is outside the bridge’s history window. Check Grok Bot for the reply.');
    }
    await sleep(Math.min(pollMs, Math.max(0, deadline - now())));
  }
  return notice('Grok accepted the message; no correlated reply arrived within the bridge’s wait window. Work may still be running or awaiting input. Continue in the Grok Bot app.');
}
