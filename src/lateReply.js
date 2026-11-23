import { mausbotRequest } from './mausbotTransport.js';

const active = new Set();

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
 * @param {object} ctx { threadKey, requestId, format, send, log }
 * @param {object} deps injectable request/sleep/now for tests
 * @returns {boolean} false if requestId missing or a watcher is already active
 */
export function watchLateReply(cfg, ctx, deps = {}) {
  const { threadKey, requestId, format, send, log = () => {} } = ctx;
  if (!requestId || !threadKey || active.has(threadKey)) return false;

  const request = deps.request || mausbotRequest;
  const now = deps.now || Date.now;
  const sleep = deps.sleep || ((ms) => new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }));
  const pollMs = cfg.mausbot?.pollMs || 2000;
  const deadline = now() + (cfg.mausbot?.lateReplyTimeoutMs || 900000);

  active.add(threadKey);
  (async () => {
    while (now() < deadline) {
      await sleep(pollMs);
      try {
        const res = await request(cfg, { mode: 'poll', threadKey, requestId });
        const reply = res?.reply;
        if (reply?.type === 'text' && typeof reply.content === 'string' && reply.content.trim()) {
          await send(format(reply.content));
          log('info', 'late reply delivered', { threadKey });
          return;
        }
      } catch {
        // A transport hiccup must not kill the watcher; try again next tick.
      }
    }
    log('info', 'late reply window expired', { threadKey });
  })().finally(() => active.delete(threadKey));

  return true;
}
