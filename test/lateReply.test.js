import test from 'node:test';
import assert from 'node:assert/strict';
import { watchLateReply, isWatchingLateReply } from '../src/lateReply.js';

const cfg = { mausbot: { pollMs: 1, lateReplyTimeoutMs: 1000 } };
const flush = () => new Promise((r) => setImmediate(r));

test('delivers the eventual reply back to the same channel', async () => {
  let t = 0;
  let calls = 0;
  const request = async () => {
    calls += 1;
    return calls < 3
      ? { delivery: 'accepted', requestId: 't1' }
      : { delivery: 'accepted', requestId: 't1', reply: { type: 'text', content: 'late answer' } };
  };
  let resolveSend;
  const gotSend = new Promise((r) => { resolveSend = r; });
  const sent = [];
  const started = watchLateReply(cfg, {
    threadKey: 'chan-A', requestId: 't1', format: (s) => `FMT:${s}`,
    send: async (s) => { sent.push(s); resolveSend(); }, log: () => {},
  }, { request, sleep: async () => { t += 10; }, now: () => t });

  assert.equal(started, true);
  assert.equal(isWatchingLateReply('chan-A'), true);
  await gotSend;
  assert.deepEqual(sent, ['FMT:late answer']);
  assert.equal(calls, 3);
  await flush();
  assert.equal(isWatchingLateReply('chan-A'), false);
});

test('stops polling when the late window expires', async () => {
  let t = 0;
  let calls = 0;
  let resolveDone;
  const done = new Promise((r) => { resolveDone = r; });
  const request = async () => { calls += 1; return { delivery: 'accepted', requestId: 't2' }; };
  const sent = [];
  const started = watchLateReply(cfg, {
    threadKey: 'chan-B', requestId: 't2', format: (s) => s,
    send: async (s) => sent.push(s),
    log: (_level, msg) => { if (msg === 'late reply window expired') resolveDone(); },
  }, { request, sleep: async () => { t += 600; }, now: () => t });

  assert.equal(started, true);
  await done;
  assert.equal(calls, 2);
  assert.equal(sent.length, 0);
  await flush();
  assert.equal(isWatchingLateReply('chan-B'), false);
});

test('refuses a missing thread id or a second watcher on the same thread', async () => {
  let t = 0;
  const request = async () => ({ delivery: 'accepted', requestId: 't3' });
  const start = (threadKey, requestId) => watchLateReply(cfg, {
    threadKey, requestId, format: (s) => s, send: async () => {}, log: () => {},
  }, { request, sleep: async () => { t += 2000; }, now: () => t });

  assert.equal(start('chan-C', null), false);
  assert.equal(start('chan-D', 't3'), true);
  assert.equal(start('chan-D', 't3'), false);
});
