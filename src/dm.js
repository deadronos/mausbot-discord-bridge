/** A DM channel is allowed only if it is type 1 (DM) and its single recipient is a non-bot on the allowlist. */

function recipientsOf(raw) {
  if (Array.isArray(raw)) return raw;
  // discord.js v14 exposes recipients as a Collection (a Map subclass), not an Array.
  if (raw && typeof raw.values === 'function') return [...raw.values()];
  return [];
}

export function isAllowedDm(channel, dmAllow) {
  if (!channel || channel.type !== 1) return false;
  const r = recipientsOf(channel.recipients);
  if (r.length !== 1) return false;
  const recipient = r[0];
  return Boolean(recipient && !recipient.bot && dmAllow.has(String(recipient.id)));
}
