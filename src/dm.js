/** A DM channel is allowed only if it is type 1 (DM) and every recipient is a non-bot on the DM allowlist. */
export function isAllowedDm(channel, dmAllow) {
  if (!channel || channel.type !== 1) return false;
  const r = Array.isArray(channel.recipients) ? channel.recipients : [];
  return r.length === 1 && !r[0].bot && dmAllow.has(String(r[0].id));
}
