/** Pure message-handling decisions, kept separate from discord.js so they can be unit-tested. */

export function isAllowedInGuild(message, cfg, clientUserId) {
  if (!message.guild) return false;
  if (!cfg.guildAllow.has(message.guild.id)) return false;
  if (!cfg.channelAllow.has(message.channel.id)) return false;
  if (message.author.id === clientUserId) return false;
  return cfg.authorAllow.has(message.author.id);
}

export function neutralizeMentions(text, mentionAllow) {
  // Peer gateways may inspect literal mention syntax even without Discord notifications.
  // Keep real pings only for explicitly allowlisted ids; neutralize every other id to plain text.
  const allow = mentionAllow || new Set();
  return String(text || '').replace(/<@!?(\d+)>/g, (_whole, id) => (allow.has(id) ? `<@${id}>` : `@user:${id}`));
}

export function formatReplyText(result, cfg) {
  let text = (result?.text || '').trim() || '(empty brain response)';
  if (result?.handoff === false) {
    return neutralizeMentions(text, cfg.mentionAllow);
  }
  const mention = `<@${cfg.peerMentionId}>`;
  return text.includes(mention) ? text : `${text}\n\n${mention}`;
}
