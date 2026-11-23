/**
 * A DM channel is allowed only if it is type 1 (1:1 DM) and its single
 * recipient is a non-bot on the allowlist.
 *
 * Handles real discord.js v14 DMChannel (`.recipient`, `.recipientId`,
 * `.recipientIds`) as well as raw/mock `.recipients` arrays or Collections.
 */

function recipientsOf(raw) {
  if (Array.isArray(raw)) return raw;
  // Some mocks or raw Discord payloads expose recipients as an Array or Collection (Map).
  if (raw && typeof raw.values === 'function') return [...raw.values()];
  return null;
}

export function isAllowedDm(channel, dmAllow, clientUserId = null) {
  if (!channel || channel.type !== 1) return false;

  const list = recipientsOf(channel.recipients);
  if (list !== null) {
    if (list.length !== 1) return false;
    const recipient = list[0];
    return Boolean(recipient && !recipient.bot && dmAllow.has(String(recipient.id)));
  }

  // discord.js v14 DMChannel stores snowflakes in `.recipientIds` and resolves `.recipient`.
  if (Array.isArray(channel.recipientIds)) {
    const others = clientUserId
      ? channel.recipientIds.filter((id) => String(id) !== String(clientUserId))
      : channel.recipientIds;
    if (others.length !== 1) return false;
    if (channel.recipient && channel.recipient.bot) return false;
    return dmAllow.has(String(others[0]));
  }

  if (channel.recipient) {
    return Boolean(!channel.recipient.bot && dmAllow.has(String(channel.recipient.id)));
  }

  if (channel.recipientId) {
    return dmAllow.has(String(channel.recipientId));
  }

  return false;
}
