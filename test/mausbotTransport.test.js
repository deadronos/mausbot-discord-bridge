import test from 'node:test';
import assert from 'node:assert/strict';
import { mausbotRequest } from '../src/mausbotTransport.js';

const cfg = {
  mausbot: {
    apiBase: 'https://maus.example/hooks/api/bots/b/messages',
    apiKey: 'SECRET-KEY-XYZ',
    actsAsMe: true,
    timeoutMs: 120000,
    pollMs: 2000,
  },
};
const sendReq = { mode: 'send', threadKey: 'chan-C', text: 'hello from discord', payload: { messageId: 'M1' } };

function stubFetch(status, body) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    return { status, ok: status >= 200 && status < 300, json: async () => body };
  };
  fn.calls = calls;
  return fn;
}
function harness(fetch, threads = new Map()) {
  return { fetch, threads };
}

test('first send posts the exact URL, bearer key and message body', async () => {
  const fetch = stubFetch(200, { reply: 'hi', thread: 't1' });
  await mausbotRequest(cfg, sendReq, harness(fetch));
  assert.equal(fetch.calls.length, 1);
  assert.equal(fetch.calls[0].url, cfg.mausbot.apiBase);
  assert.equal(fetch.calls[0].opts.method, 'POST');
  assert.equal(fetch.calls[0].opts.headers.Authorization, 'Bearer SECRET-KEY-XYZ');
  const body = JSON.parse(fetch.calls[0].opts.body);
  assert.equal(body.message, 'hello from discord');
  assert.equal(body.thread, undefined);
  assert.equal(typeof body.wait, 'number');
});

test('maps a 200 reply and remembers the server-created thread id', async () => {
  const threads = new Map();
  const fetch = stubFetch(200, { reply: 'hello back', thread: 't1' });
  const res = await mausbotRequest(cfg, sendReq, harness(fetch, threads));
  assert.deepEqual(res, { delivery: 'accepted', requestId: 't1', reply: { type: 'text', content: 'hello back' } });
  assert.equal(threads.get('chan-C'), 't1');
});

test('a later send reuses the stored thread id', async () => {
  const threads = new Map([['chan-C', 't1']]);
  const fetch = stubFetch(200, { reply: 'again', thread: 't1' });
  await mausbotRequest(cfg, sendReq, harness(fetch, threads));
  assert.equal(JSON.parse(fetch.calls[0].opts.body).thread, 't1');
});

test('poll uses GET with the thread id', async () => {
  const fetch = stubFetch(200, { reply: 'polled reply', thread: 't1' });
  const res = await mausbotRequest(cfg, { mode: 'poll', threadKey: 'chan-C', requestId: 't1' }, harness(fetch));
  assert.equal(fetch.calls[0].url, `${cfg.mausbot.apiBase}?thread=t1`);
  assert.equal(fetch.calls[0].opts.method, 'GET');
  assert.equal(res.reply.content, 'polled reply');
});

test('maps 202 needs_approval to an approval reply', async () => {
  const fetch = stubFetch(202, { thread: 't1', status: 'needs_approval' });
  const res = await mausbotRequest(cfg, sendReq, harness(fetch));
  assert.deepEqual(res, { delivery: 'accepted', requestId: 't1', reply: { type: 'approval' } });
});

test('maps 202 working so the adapter keeps polling', async () => {
  const fetch = stubFetch(202, { thread: 't1', status: 'working' });
  const res = await mausbotRequest(cfg, sendReq, harness(fetch));
  assert.equal(res.delivery, 'accepted');
  assert.equal(res.requestId, 't1');
  assert.equal(res.status, 'working');
  assert.equal(res.reply, undefined);
});

test('maps 401 to unauthorized', async () => {
  const fetch = stubFetch(401, { error: 'Invalid key' });
  const res = await mausbotRequest(cfg, sendReq, harness(fetch));
  assert.deepEqual(res, { error: 'unauthorized' });
});

test('maps an acts-as-owner refusal to acts_as_me_unavailable', async () => {
  const fetch = stubFetch(403, { error: "A key can't act as the owner here." });
  const res = await mausbotRequest(cfg, sendReq, harness(fetch));
  assert.deepEqual(res, { error: 'acts_as_me_unavailable' });
});

test('maps an aborted request to timeout', async () => {
  const fetch = async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; };
  const res = await mausbotRequest(cfg, sendReq, harness(fetch));
  assert.deepEqual(res, { error: 'timeout' });
});

test('never logs the key', async () => {
  const fetch = stubFetch(401, { error: 'Invalid key' });
  const original = console.error;
  const originalLog = console.log;
  const lines = [];
  console.error = (...a) => lines.push(a.join(' '));
  console.log = (...a) => lines.push(a.join(' '));
  try {
    await mausbotRequest(cfg, sendReq, harness(fetch));
  } finally {
    console.error = original;
    console.log = originalLog;
  }
  assert.doesNotMatch(lines.join('\n'), /SECRET-KEY-XYZ/);
});

test('maps an unconfinable AI refusal to cannot_confine', async () => {
  const fetch = stubFetch(403, { error: "This bot's AI can't take Bot API calls. Choose another AI for this bot." });
  const res = await mausbotRequest(cfg, sendReq, harness(fetch));
  assert.deepEqual(res, { error: 'cannot_confine' });
});
