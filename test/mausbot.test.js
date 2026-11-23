import test from 'node:test';
import assert from 'node:assert/strict';
import { makeThreadKey, thinkMausbot } from '../src/mausbot.js';

const cfg = {
  mausbot: {
    apiBase: 'https://maus.example/api',
    apiKey: 'SECRET-KEY-XYZ',
    actsAsMe: true,
    timeoutMs: 1000,
    pollMs: 10,
  },
};
const payload = {
  text: 'hello from discord',
  authorId: 'A',
  authorTag: 'owner#1',
  isBot: false,
  channelId: 'C',
  guildId: 'G',
  isDM: false,
  messageId: 'M1',
};

function depsFor(response, opts = {}) {
  let calls = 0;
  return {
    get calls() { return calls; },
    request: async (c, req) => {
      calls += 1;
      return typeof response === 'function' ? response(c, req, calls) : response;
    },
    now: opts.now || (() => 0),
    sleep: opts.sleep || (async () => {}),
  };
}

test('makeThreadKey maps a DM to the author', () => {
  assert.equal(makeThreadKey({ isDM: true, authorId: 'A' }), 'dm:A');
});

test('makeThreadKey maps a channel to the channel id', () => {
  assert.equal(makeThreadKey({ isDM: false, channelId: 'C' }), 'chan:C');
});

test('sends the thread key, text and payload to the request function', async () => {
  let captured;
  const d = depsFor(async (c, req) => { captured = req; return { delivery: 'accepted', reply: { type: 'text', content: 'ok' } }; });
  await thinkMausbot(cfg, payload, d);
  assert.equal(captured.threadKey, 'chan:C');
  assert.equal(captured.text, payload.text);
  assert.equal(captured.payload, payload);
});

test('returns the correlated reply text with handoff disabled', async () => {
  const d = depsFor({ delivery: 'accepted', requestId: 'r1', reply: { type: 'text', content: '  hello back  ' } });
  const result = await thinkMausbot(cfg, payload, d);
  assert.equal(result.text, 'hello back');
  assert.equal(result.handoff, false);
});

test('reports acts-as-me unavailable as text-only', async () => {
  const d = depsFor({ error: 'acts_as_me_unavailable' });
  const result = await thinkMausbot(cfg, payload, d);
  assert.match(result.text, /text-only/);
  assert.match(result.text, /MausBot/);
  assert.equal(result.handoff, false);
});

test('reports auth failure without echoing the key', async () => {
  const d = depsFor({ error: 'unauthorized' });
  const result = await thinkMausbot(cfg, payload, d);
  assert.match(result.text, /access/i);
  assert.doesNotMatch(JSON.stringify(result), /SECRET-KEY-XYZ/);
});

test('never retries unconfirmed delivery', async () => {
  const d = depsFor({ delivery: 'unconfirmed' });
  const result = await thinkMausbot(cfg, payload, d);
  assert.equal(d.calls, 1);
  assert.match(result.text, /check MausBot|do not resend/i);
});

test('reports timeout when no correlated reply arrives', async () => {
  let t = 0;
  const d = depsFor({ delivery: 'accepted', requestId: 'r1', reply: null }, {
    now: () => t,
    sleep: async () => { t += 100; },
  });
  const result = await thinkMausbot(cfg, payload, d);
  assert.match(result.text, /no reply/i);
  assert.equal(result.handoff, false);
});

test('reports needs-approval instead of approving', async () => {
  const d = depsFor({ delivery: 'accepted', requestId: 'r1', reply: { type: 'approval' } });
  const result = await thinkMausbot(cfg, payload, d);
  assert.match(result.text, /Open MausBot to approve/);
});

test('never echoes secrets in any result', async () => {
  const responses = [
    { error: 'acts_as_me_unavailable' },
    { error: 'unauthorized' },
    { delivery: 'rejected' },
    { delivery: 'unconfirmed' },
    { delivery: 'accepted', reply: { type: 'approval' } },
    { delivery: 'accepted', reply: { type: 'text', content: 'ok' } },
  ];
  for (const response of responses) {
    const result = await thinkMausbot(cfg, payload, depsFor(response));
    assert.doesNotMatch(JSON.stringify(result), /SECRET-KEY-XYZ/);
  }
});
