/** Simple fixed-window rate limiter keyed by author id. */

export class RateLimiter {
  constructor(maxPerWindow, windowMs) {
    this.max = maxPerWindow;
    this.windowMs = windowMs;
    this.hits = new Map(); // id -> number[] timestamps
  }

  allow(id, now = Date.now()) {
    const windowStart = now - this.windowMs;
    const prev = (this.hits.get(id) || []).filter((t) => t > windowStart);
    if (prev.length >= this.max) {
      this.hits.set(id, prev);
      return false;
    }
    prev.push(now);
    this.hits.set(id, prev);
    return true;
  }
}
