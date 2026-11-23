import test from 'node:test';
import assert from 'node:assert/strict';
import { createSendApi } from '../src/sendApi.js';

const secret = 'test-send-secret';
const GUILD_ID = '100000000000000001';
const CHANNEL_ID = '200000000000000002';
const OWNER_ID = '300000000000000003';
const PEER_ID = '400000000000000004';

const cfg = {
  guildAllow: new Set([GUILD_ID]),
  channelAllow: new Set([CHANNEL_ID]),
  dmAllow: new Set([OWNER_ID]),
  mentionAllow: new Set([PEER_ID]),
  rateLimitPerUser: 8,
  rateLimitWindowMs: 60000,
  sendApi: { secret, port: 0 },
};

function fakeClient(channelGuildId = GUILD_ID) {
  const sent = [];
  return {
    sent,
    channels: {
      fetch: async (id) => ({
        guildId: channelGuildId,
        send: async (o) => { sent.push({ target: id, ...o }); },
      }),
    },
    users: {
      fetch: async (id) => ({
        bot: false,
        createDM: async () => ({ send: async (o) => { sent.push({ target: `dm:${id}`, ...o }); } }),
      }),
    },
  };
}

async function withServer(fn, cfgOverrides = {}, clientGuildId = GUILD_ID) {
  const client = fakeClient(clientGuildId);
  const server = createSendApi({ ...cfg, ...cfgOverrides }, client);
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
    const wrong = await post(port, { channel_id: CHANNEL_ID, content: 'hi' }, 'Bearer nope');
    assert.equal(wrong.status, 401);
    assert.equal(client.sent.length, 0);
  });
});

test('send API posts to an allowed channel with scoped and neutralized mentions', async () => {
  await withServer(async ({ port, client }) => {
    const res = await post(port, { channel_id: CHANNEL_ID, content: `hello <@${PEER_ID}> and <@999999>` });
    assert.equal(res.status, 200);
    assert.equal(client.sent.length, 1);
    assert.equal(client.sent[0].target, CHANNEL_ID);
    assert.equal(client.sent[0].content, `hello <@${PEER_ID}> and @user:999999`);
    assert.deepEqual(client.sent[0].allowedMentions.users, [PEER_ID]);
    assert.equal(client.sent[0].allowedMentions.parse.length, 0);
  });
});

test('send API opens a DM for an allowlisted user', async () => {
  await withServer(async ({ port, client }) => {
    const res = await post(port, { user_id: OWNER_ID, content: 'hello dm' });
    assert.equal(res.status, 200);
    assert.equal(client.sent.length, 1);
    assert.equal(client.sent[0].target, `dm:${OWNER_ID}`);
    assert.equal(client.sent[0].content, 'hello dm');
  });
});

test('send API rejects targets outside the allowlists', async () => {
  await withServer(async ({ port, client }) => {
    const channel = await post(port, { channel_id: '999', content: 'hi' });
    assert.equal(channel.status, 403);
    const user = await post(port, { user_id: '999', content: 'hi' });
    assert.equal(user.status, 403);
    const both = await post(port, { channel_id: CHANNEL_ID, user_id: OWNER_ID, content: 'hi' });
    assert.equal(both.status, 400);
    assert.equal(client.sent.length, 0);
  });
});

test('send API rejects a channel belonging to a non-allowlisted guild', async () => {
  await withServer(async ({ port, client }) => {
    const res = await post(port, { channel_id: CHANNEL_ID, content: 'hi' });
    assert.equal(res.status, 403);
    assert.equal(client.sent.length, 0);
  }, {}, '999999999999999999');
});

test('send API enforces rate limits', async () => {
  await withServer(async ({ port, client }) => {
    assert.equal((await post(port, { channel_id: CHANNEL_ID, content: '1' })).status, 200);
    assert.equal((await post(port, { channel_id: CHANNEL_ID, content: '2' })).status, 200);
    assert.equal((await post(port, { channel_id: CHANNEL_ID, content: '3' })).status, 429);
    assert.equal(client.sent.length, 2);
  }, { rateLimitPerUser: 2, rateLimitWindowMs: 60000 });
});
