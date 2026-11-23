/** Keep Discord's short-lived typing indicator alive during a long brain call. */

/**
 * Send an initial typing state, then refresh it on an interval until stopped.
 * Discord shows "is typing" for only a few seconds, so without refresh a long
 * MausBot turn looks identical to a dead/timeout request.
 *
 * @param {{sendTyping: () => Promise<unknown>}} channel Discord channel-like object
 * @param {number} intervalMs refresh cadence (configurable via TYPING_PULSE_MS)
 * @param {object} deps injectable timers for tests
 * @returns {() => void} stop function — safe to call more than once
 */
export function startTypingPulse(channel, intervalMs = 5000, deps = {}) {
  const setTimer = deps.setInterval || ((fn, ms) => setInterval(fn, ms));
  const clearTimer = deps.clearInterval || ((id) => clearInterval(id));
  let stopped = false;

  const timer = setTimer(() => {
    if (stopped) return;
    try {
      // Typing is best-effort: a failure must never fail the underlying request.
      Promise.resolve(channel.sendTyping()).catch(() => {});
    } catch {
      /* ignore */
    }
  }, intervalMs);

  // A pending timer should not keep the bridge process alive on shutdown.
  if (timer && typeof timer.unref === 'function') timer.unref();

  return () => {
    stopped = true;
    clearTimer(timer);
  };
}
