import test from 'node:test';
import assert from 'node:assert/strict';
import { startTypingPulse } from '../src/typing.js';

test('typing pulse repeats while running and stops cleanly', () => {
  let fn;
  let cleared;
  let sends = 0;
  const stop = startTypingPulse({ sendTyping: async () => { sends += 1; } }, 4000, {
    setInterval: (f) => { fn = f; return 'timer'; },
    clearInterval: (t) => { cleared = t; },
  });
  assert.equal(typeof fn, 'function');
  fn();
  fn();
  assert.equal(sends, 2);
  stop();
  assert.equal(cleared, 'timer');
  fn();
  assert.equal(sends, 2, 'no typing after stop');
});

test('typing pulse swallows a failed sendTyping call', async () => {
  let fn;
  const stop = startTypingPulse({ sendTyping: () => { throw new Error('channel gone'); } }, 1000, {
    setInterval: (f) => { fn = f; return 1; },
    clearInterval: () => {},
  });
  assert.doesNotThrow(() => fn());
  await Promise.resolve();
  stop();
});

test('stop is idempotent', () => {
  let clears = 0;
  const stop = startTypingPulse({ sendTyping: async () => {} }, 1000, {
    setInterval: () => 1,
    clearInterval: () => { clears += 1; },
  });
  stop();
  stop();
  assert.equal(clears, 2);
});
