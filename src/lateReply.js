import { mausbotRequest } from './mausbotTransport.js';

const active = new Set();

const TERMINAL_ERRORS = {
  unauthorized: 'MausBot refused the request while checking for a reply. Check the Bot API key and access in MausBot settings.',
  acts_as_me_unavailable: 'This MausBot install does not allow tool access for apps. Check MausBot settings to enable "Acts as me".',
  cannot_confine: 'This MausBot AI cannot take Bot API calls. Ask the owner to mark the key as acting for them in MausBot.',
};

function capReply(content) {
  const t = String(content).trim();
  return t.length > 12_000
    ? `${t.slice(0, 12_000)}\n\n[Long reply shortened; full text is in MausBot.]`
    : t;
}

/** True while a background poller is already waiting on this thread. */
export function isWatchingLateReply(threadKey) {
  return active.has(threadKey);
}

/**
 * A MausBot turn can outlast the bridge's foreground wait window. Without this,
 * the bridge posts a timeout notice and the eventual reply only appears in the
 * MausBot window — Discord never sees it. Keep polling the same thread in the
 * background and post the real reply to the same channel when it arrives.
 *
 * @param {object} cfg bridge config
 * @param {object} ctx { threadKey, requestId, format, send, log, onFinish }
 * @param {object} deps injectable request/sleep/now for tests
 * @returns {boolean} false if requestId missing or a watcher is already active
 */
export function watchLateReply(cfg, ctx, deps = {}) {
  const { threadKey, requestId, format, send, log = () => {}, onFinish = () => {} } = ctx;
  if (!requestId || !threadKey || active.has(threadKey)) return false;

  const request = deps.request || mausbotRequest;
  const now = deps.now || Date.now;
  const sleep = deps.sleep || ((ms) => new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }));
  const pollMs = cfg.mausbot?.pollMs || 2000;
  const deadline = now() + (cfg.mausbot?.lateReplyTimeoutMs || 900000);

  async function deliver(text, eventName) {
    try {
      await send(text);
      log('info', eventName, { threadKey });
    } catch {
      log('warn', 'late reply delivery failed', { threadKey });
    }
  }

  active.add(threadKey);
  (async () => {
    while (now() < deadline) {
      await sleep(pollMs);
      let res;
      try {
        res = await request(cfg, { mode: 'poll', threadKey, requestId });
      } catch {
        // A transport hiccup must not kill the watcher; try again next tick.
        continue;
      }

      if (res?.error && TERMINAL_ERRORS[res.error]) {
        await deliver(TERMINAL_ERRORS[res.error], 'late reply terminal error');
        return;
      }
      if (res?.delivery === 'rejected') {
        await deliver('MausBot rejected the request. Check MausBot for access or usage issues.', 'late reply rejected');
        return;
      }

      const reply = res?.reply;
      if (reply?.type === 'approval') {
        await deliver('MausBot needs your approval. Open MausBot to approve — this bridge does not approve actions.', 'late reply needs approval');
        return;
      }
      if (reply?.type === 'text' && typeof reply.content === 'string' && reply.content.trim()) {
        await deliver(format(capReply(reply.content)), 'late reply delivered');
        return;
      }
    }
    log('info', 'late reply window expired', { threadKey });
  })().finally(() => {
    active.delete(threadKey);
    try { onFinish(); } catch { /* ignore */ }
  });

  return true;
}
