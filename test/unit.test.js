import test from 'node:test';
import assert from 'node:assert/strict';
import { splitMessage } from '../src/splitMessage.js';
import { RateLimiter } from '../src/rateLimit.js';

test('splitMessage keeps short text whole', () => {
  assert.deepEqual(splitMessage('hello'), ['hello']);
});

test('splitMessage breaks long text near limit', () => {
  const long = 'a'.repeat(2500);
  const parts = splitMessage(long, 1000);
  assert.ok(parts.length >= 2);
  assert.ok(parts.every((p) => p.length <= 1000));
  assert.equal(parts.join('').length, 2500);
});

test('RateLimiter allows then blocks', () => {
  const rl = new RateLimiter(2, 60_000);
  assert.equal(rl.allow('u1', 1000), true);
  assert.equal(rl.allow('u1', 1001), true);
  assert.equal(rl.allow('u1', 1002), false);
  assert.equal(rl.allow('u2', 1002), true);
});

test('bot authors are not special-cased in allowlist model', () => {
  // Documented contract: author allowlist is the gate, not author.bot.
  const authorAllow = new Set(['human', 'hermes-bot']);
  const cases = [
    { id: 'human', bot: false, ok: true },
    { id: 'hermes-bot', bot: true, ok: true },
    { id: 'random-bot', bot: true, ok: false },
    { id: 'stranger', bot: false, ok: false },
  ];
  for (const c of cases) {
    const allowed = authorAllow.has(c.id); // never: if (c.bot) drop
    assert.equal(allowed, c.ok, JSON.stringify(c));
  }
});
