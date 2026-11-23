/**
 * MausBot brain adapter. The Bot API wire format lives in mausbotTransport.js;
 * everything here is about correlation, notices and safe failure handling.
 * A send happens at most once — later iterations only poll for its reply.
 */

export function makeThreadKey(payload) {
  // MausBot validates thread ids with /^[\w-]{1,128}$/ — a colon is not allowed.
  return payload.isDM ? `dm-${payload.authorId}` : `chan-${payload.channelId}`;
}

function notice(text) {
  return { text, handoff: false };
}

function textReply(content) {
  const t = String(content).trim();
  const capped = t.length > 12_000
    ? `${t.slice(0, 12_000)}\n\n[Long reply shortened; full text is in MausBot.]`
    : t;
  return { text: capped, handoff: false };
}

export async function thinkMausbot(cfg, payload, deps = {}) {
  const request = deps.request || (() => { throw new Error('mausbot transport not wired'); });
  const now = deps.now || Date.now;
  const sleep = deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const cfgBot = cfg.mausbot || {};
  const threadKey = makeThreadKey(payload);
  const deadline = now() + (cfgBot.timeoutMs || 120_000);
  const pollMs = cfgBot.pollMs || 2_000;
  let requestId;
  let first = true;

  while (now() < deadline) {
    const req = first
      ? { mode: 'send', threadKey, text: payload.text, payload }
      : { mode: 'poll', threadKey, requestId };
    first = false;

    let res;
    try {
      res = await request(cfg, req);
    } catch {
      return requestId
        ? notice('MausBot accepted the message, but the bridge could not read its reply. Continue in MausBot; do not resend.')
        : notice('MausBot delivery is unconfirmed. Check MausBot before sending again; the bridge will not retry.');
    }

    if (res?.error === 'acts_as_me_unavailable') {
      return notice('This MausBot install does not allow tool access for apps. Discord requests are text-only. Check MausBot settings to enable "Acts as me".');
    }
    if (res?.error === 'unauthorized') {
      return notice('MausBot refused the request. Check the Bot API key and access in MausBot settings.');
    }
    if (res?.error === 'timeout') {
      return notice('MausBot did not answer in time. Check MausBot before trying again; the bridge will not resend.');
    }
    if (res?.error === 'rate_limited') {
      return notice('MausBot is rate limiting requests. Try again shortly.');
    }
    if (res?.error === 'unavailable') {
      return notice('MausBot is unavailable right now. Try again shortly.');
    }
    if (res?.error === 'cannot_confine') {
      return notice('This MausBot AI cannot take Bot API calls. Ask the owner to mark the key as acting for them in MausBot.');
    }
    if (res?.delivery === 'rejected') {
      return notice('MausBot rejected the message. Check MausBot for access or usage issues.');
    }
    if (res?.delivery !== 'accepted') {
      return notice('MausBot delivery is unconfirmed. Check MausBot before sending again; the bridge will not retry.');
    }

    if (typeof res.requestId === 'string' && res.requestId) {
      if (requestId && requestId !== res.requestId) {
        return notice('MausBot reply correlation changed. Check MausBot for the reply; do not resend.');
      }
      requestId = res.requestId;
    }

    const reply = res.reply;
    if (reply?.type === 'approval') {
      return notice('MausBot needs your approval. Open MausBot to approve — this bridge does not approve actions.');
    }
    if (reply?.type === 'text' && typeof reply.content === 'string' && reply.content.trim()) {
      return textReply(reply.content);
    }

    await sleep(Math.min(pollMs, Math.max(0, deadline - now())));
  }

  return notice('MausBot accepted the message, but no reply arrived within the bridge wait window. Work may still be running. Check MausBot; do not resend.');
}
