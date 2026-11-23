import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedDm } from '../src/dm.js';

const OWNER = '111111111111111111';
const BOT_SELF = '999999999999999999';
const allow = new Set([OWNER]);

test('isAllowedDm accepts discord.js v14 DMChannel shape (recipientIds / recipient)', () => {
  assert.equal(isAllowedDm({ type: 1, recipientIds: [OWNER], recipient: { id: OWNER, bot: false } }, allow, BOT_SELF), true);
  assert.equal(isAllowedDm({ type: 1, recipientIds: [BOT_SELF, OWNER], recipient: { id: OWNER, bot: false } }, allow, BOT_SELF), true);
  assert.equal(isAllowedDm({ type: 1, recipientIds: [OWNER, '222222222222222222'], recipient: { id: OWNER, bot: false } }, allow, BOT_SELF), false);
  assert.equal(isAllowedDm({ type: 1, recipientIds: [OWNER], recipient: { id: OWNER, bot: true } }, allow, BOT_SELF), false);
  assert.equal(isAllowedDm({ type: 1, recipientIds: ['222222222222222222'], recipient: { id: '222222222222222222', bot: false } }, allow, BOT_SELF), false);
  assert.equal(isAllowedDm({ type: 1, recipient: { id: OWNER, bot: false } }, allow, BOT_SELF), true);
  assert.equal(isAllowedDm({ type: 1, recipientId: OWNER }, allow, BOT_SELF), true);
  assert.equal(isAllowedDm({ type: 1 }, allow, BOT_SELF), false);
});

test('isAllowedDm also handles array/Collection recipients and rejects group DMs', () => {
  assert.equal(isAllowedDm({ type: 1, recipients: [{ id: OWNER }] }, allow), true);
  assert.equal(isAllowedDm({ type: 1, recipients: [{ id: '999' }] }, allow), false);
  assert.equal(isAllowedDm({ type: 1, recipients: [{ id: OWNER, bot: true }] }, allow), false);
  assert.equal(isAllowedDm({ type: 0, recipients: [{ id: OWNER }] }, allow), false);
  assert.equal(isAllowedDm({ type: 3, recipients: [{ id: OWNER }, { id: '1' }] }, allow), false);
  assert.equal(isAllowedDm(null, allow), false);
  const collection = new Map([[OWNER, { id: OWNER, bot: false }]]);
  assert.equal(isAllowedDm({ type: 1, recipients: collection }, allow), true);
  const group = new Map([[OWNER, { id: OWNER }], ['2', { id: '2' }]]);
  assert.equal(isAllowedDm({ type: 1, recipients: group }, allow), false);
});
