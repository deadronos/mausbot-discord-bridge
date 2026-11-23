/** Pure message-handling decisions, kept separate from discord.js so they can be unit-tested. */

export function isAllowedInGuild(message, cfg, clientUserId) {
  if (!message.guild) return false;
  if (!cfg.guildAllow.has(message.guild.id)) return false;
  if (!cfg.channelAllow.has(message.channel.id)) return false;
  if (message.author.id === clientUserId) return false;
  return cfg.authorAllow.has(message.author.id);
}

export function formatReplyText(result, cfg) {
  let text = (result?.text || '').trim() || '(empty brain response)';
  if (result?.handoff === false) {
    // A MausBot reply may quote a Discord mention. Keep real pings only for the
    // explicitly allowlisted peer ids; neutralize every other id to plain text.
    const allow = cfg.mentionAllow || new Set();
    return text.replace(/<@!?(\d+)>/g, (whole, id) => (allow.has(id) ? `<@${id}>` : `@user:${id}`));
  }
  const mention = `<@${cfg.peerMentionId}>`;
  return text.includes(mention) ? text : `${text}\n\n${mention}`;
}
