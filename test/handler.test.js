import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedInGuild, formatReplyText } from '../src/handlerPure.js';
import { splitMessage } from '../src/splitMessage.js';

const cfg = {
  guildAllow: new Set(['g']),
  channelAllow: new Set(['c']),
  authorAllow: new Set(['owner']),
  peerMentionId: 'peer',
};
function guildMessage(authorId) {
  return { guild: { id: 'g' }, channel: { id: 'c' }, author: { id: authorId } };
}

test('drops a non-owner author in an allowed channel', () => {
  assert.equal(isAllowedInGuild(guildMessage('NOT-OWNER'), cfg, 'bot-id'), false);
  assert.equal(isAllowedInGuild(guildMessage('owner'), cfg, 'bot-id'), true);
});

test('ignores its own messages', () => {
  assert.equal(isAllowedInGuild(guildMessage('bot-id'), cfg, 'bot-id'), false);
});

test('drops messages from a non-allowed channel or guild', () => {
  const wrongChannel = { guild: { id: 'g' }, channel: { id: 'other' }, author: { id: 'owner' } };
  const wrongGuild = { guild: { id: 'other' }, channel: { id: 'c' }, author: { id: 'owner' } };
  assert.equal(isAllowedInGuild(wrongChannel, cfg, 'bot-id'), false);
  assert.equal(isAllowedInGuild(wrongGuild, cfg, 'bot-id'), false);
});

test('reply never pings mentioned users and appends no peer mention', () => {
  const text = formatReplyText({ text: 'hi <@123> and <@!456>', handoff: false }, cfg);
  assert.match(text, /@user:123/);
  assert.match(text, /@user:456/);
  assert.doesNotMatch(text, /<@/);
  assert.doesNotMatch(text, /<@peer>/);
});

test('long reply is split into ordered complete chunks', () => {
  const long = 'a'.repeat(4200);
  const chunks = splitMessage(long, 1900);
  assert.equal(chunks.length, 3);
  assert.equal(chunks.join(''), long);
});
