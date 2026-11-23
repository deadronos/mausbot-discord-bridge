/**
 * Concrete MausBot Bot API transport. See docs/mausbot-api.md for the observed
 * contract. One POST per Discord message; later calls are GETs that only read
 * the reply, so a timeout can never re-send (and never repeats a tool action).
 */
import fs from 'node:fs';

const DEFAULT_THREAD_FILE = './threads.json';

/** One store per process, so concurrent DM/channel calls cannot overwrite each other's thread ids. */
const sharedStores = new Map();
export function getSharedThreadStore(file = process.env.MAUSBOT_THREAD_FILE || DEFAULT_THREAD_FILE) {
  if (!sharedStores.has(file)) sharedStores.set(file, createThreadStore(file));
  return sharedStores.get(file);
}

/** The server's wait must fit inside our own abort deadline, or we lose the thread id. */
function waitSeconds(timeoutMs) {
  const ceiling = Math.floor((timeoutMs || 120_000) / 1000) - 5;
  return Math.max(1, Math.min(45, ceiling));
}

export function createThreadStore(file = DEFAULT_THREAD_FILE) {
  let map = new Map();
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      map = new Map(Object.entries(parsed).filter(([, v]) => typeof v === 'string'));
    }
  } catch {
    // No store yet — start empty. Never log the path or the error.
  }
  const save = () => {
    try {
      fs.writeFileSync(file, JSON.stringify(Object.fromEntries(map), null, 2), { mode: 0o600 });
    } catch {
      // Persistence is best-effort; losing it only costs thread continuity.
    }
  };
  return {
    get: (key) => map.get(key),
    set: (key, value) => { map.set(key, value); save(); },
  };
}

export async function mausbotRequest(cfg, req, deps = {}) {
  const fetchFn = deps.fetch || fetch;
  const threads = deps.threads || getSharedThreadStore();
  const bot = cfg.mausbot || {};
  const headers = {
    Authorization: `Bearer ${bot.apiKey || ''}`,
    'Content-Type': 'application/json',
  };
  let url = bot.apiBase || '';
  let opts;
  if (req.mode === 'poll') {
    url = `${url}?thread=${encodeURIComponent(req.requestId || '')}`;
    opts = { method: 'GET', headers, signal: AbortSignal.timeout(bot.timeoutMs || 120_000) };
  } else {
    const body = { message: req.text, wait: waitSeconds(bot.timeoutMs) };
    const known = threads.get(req.threadKey);
    if (known) body.thread = known;
    opts = {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(bot.timeoutMs || 120_000),
    };
  }

  let res;
  try {
    res = await fetchFn(url, opts);
  } catch {
    return { error: 'timeout' };
  }
  let data = {};
  try {
    data = await res.json();
  } catch {
    // Keep the status-based mapping below.
  }

  if (res.status === 401) return { error: 'unauthorized' };
  if (res.status === 403) {
    const msg = String(data.error || '');
    if (/can't take Bot API calls/i.test(msg)) return { error: 'cannot_confine' };
    return /act as (the )?owner|no longer acts as the owner|can't act/i.test(msg)
      ? { error: 'acts_as_me_unavailable' }
      : { error: 'unauthorized' };
  }
  if (res.status === 429) return { error: 'rate_limited' };
  if (res.status >= 500) return { error: 'unavailable' };
  if (res.status !== 200 && res.status !== 202) return { delivery: 'unconfirmed' };

  const thread = typeof data.thread === 'string' && data.thread ? data.thread : req.requestId;
  if (thread && req.mode === 'send') threads.set(req.threadKey, thread);

  if (res.status === 202) {
    if (data.status === 'needs_approval') {
      return { delivery: 'accepted', requestId: thread, reply: { type: 'approval' } };
    }
    return { delivery: 'accepted', requestId: thread, status: data.status || 'working' };
  }

  const reply = typeof data.reply === 'string' && data.reply.trim() ? data.reply : '';
  if (!reply) return { delivery: 'accepted', requestId: thread, status: 'working' };
  return { delivery: 'accepted', requestId: thread, reply: { type: 'text', content: reply } };
}
