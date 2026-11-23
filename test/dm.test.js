import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedDm } from '../src/dm.js';
const allow = new Set(['300000000000000003']);
test('isAllowedDm accepts only 1:1 DMs with allowlisted humans', () => {
  assert.equal(isAllowedDm({ type: 1, recipients: [{ id: '300000000000000003' }] }, allow), true);
  assert.equal(isAllowedDm({ type: 1, recipients: [{ id: '999' }] }, allow), false);
  assert.equal(isAllowedDm({ type: 1, recipients: [{ id: '300000000000000003', bot: true }] }, allow), false);
  assert.equal(isAllowedDm({ type: 0, recipients: [{ id: '300000000000000003' }] }, allow), false);
  assert.equal(isAllowedDm({ type: 3, recipients: [{ id: '300000000000000003' }, { id: '1' }] }, allow), false);
  assert.equal(isAllowedDm(null, allow), false);
  // discord.js v14 exposes recipients as a Collection (Map), not an Array.
  const collection = new Map([['300000000000000003', { id: '300000000000000003', bot: false }]]);
  assert.equal(isAllowedDm({ type: 1, recipients: collection }, allow), true);
  const group = new Map([['300000000000000003', { id: '300000000000000003' }], ['2', { id: '2' }]]);
  assert.equal(isAllowedDm({ type: 1, recipients: group }, allow), false);
});
