import test from 'node:test';
import assert from 'node:assert/strict';
import { createSendApi } from '../src/sendApi.js';

const secret = 'test-send-secret';
const cfg = {
  channelAllow: new Set(['200000000000000002']),
  dmAllow: new Set(['300000000000000003']),
  mentionAllow: new Set(['400000000000000004']),
  sendApi: { secret, port: 0 },
};

function fakeClient() {
  const sent = [];
  return {
    sent,
    channels: { fetch: async (id) => ({ send: async (o) => { sent.push({ target: id, ...o }); } }) },
    users: {
      fetch: async (id) => ({
        bot: false,
        createDM: async () => ({ send: async (o) => { sent.push({ target: `dm:${id}`, ...o }); } }),
      }),
    },
  };
}

async function withServer(fn) {
  const client = fakeClient();
  const server = createSendApi(cfg, client);
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  const port = server.address().port;
  try {
    return await fn({ port, client });
  } finally {
    await new Promise((r) => server.close(r));
  }
}

function post(port, body, auth = `Bearer ${secret}`) {
  return fetch(`http://127.0.0.1:${port}/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: auth },
    body: JSON.stringify(body),
  });
}

test('send API refuses a missing or wrong secret', async () => {
  await withServer(async ({ port, client }) => {
    const noAuth = await fetch(`http://127.0.0.1:${port}/send`, { method: 'POST', body: '{}' });
    assert.equal(noAuth.status, 401);
    const wrong = await post(port, { channel_id: '200000000000000002', content: 'hi' }, 'Bearer nope');
    assert.equal(wrong.status, 401);
    assert.equal(client.sent.length, 0);
  });
});

test('send API posts to an allowed channel with scoped mentions', async () => {
  await withServer(async ({ port, client }) => {
    const res = await post(port, { channel_id: '200000000000000002', content: 'hello channel' });
    assert.equal(res.status, 200);
    assert.equal(client.sent.length, 1);
    assert.equal(client.sent[0].target, '200000000000000002');
    assert.equal(client.sent[0].content, 'hello channel');
    assert.deepEqual(client.sent[0].allowedMentions.users, ['400000000000000004']);
    assert.equal(client.sent[0].allowedMentions.parse.length, 0);
  });
});

test('send API opens a DM for an allowlisted user', async () => {
  await withServer(async ({ port, client }) => {
    const res = await post(port, { user_id: '300000000000000003', content: 'hello dm' });
    assert.equal(res.status, 200);
    assert.equal(client.sent.length, 1);
    assert.equal(client.sent[0].target, 'dm:300000000000000003');
    assert.equal(client.sent[0].content, 'hello dm');
  });
});

test('send API rejects targets outside the allowlists', async () => {
  await withServer(async ({ port, client }) => {
    const channel = await post(port, { channel_id: '999', content: 'hi' });
    assert.equal(channel.status, 403);
    const user = await post(port, { user_id: '999', content: 'hi' });
    assert.equal(user.status, 403);
    const both = await post(port, { channel_id: '200000000000000002', user_id: '300000000000000003', content: 'hi' });
    assert.equal(both.status, 400);
    assert.equal(client.sent.length, 0);
  });
});
