import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { thinkGbot, runGbot } from '../src/gbot.js';

const cfg = { gbot: { binary: '/mock/gbot', target: 'bot-1', timeoutMs: 1000, pollMs: 250 } };
const payload = { messageId: 'd1', authorId: 'human', channelId: 'c1', text: '--help\n```js\n  hello();\n``` $(echo DO_NOT_RUN)' };
const source = { id: 'm1', kind: 'message', requestId: 'r1' };
const reply = (requestId, content, type = 'text') => ({ id: 'out', kind: 'send-message', requestId, message: { type, content } });
function fixture(options = {}) {
  const calls = []; let time = 0, polls = 0;
  return {
    calls,
    deps: {
      now: () => time,
      sleep: async (ms) => { time += ms; },
      run: async (_bin, args) => {
        calls.push(args);
        if (args[0] === '--version') return options.version ?? '0.12.0';
        if (args.at(-1) === '1') return JSON.stringify({ target: { id: 'bot-1', isGroup: options.group ?? false }, transcript: { entries: [] } });
        if (args[0] === 'send') {
          if (options.sendError) throw new Error('synthetic-secret');
          return options.rawReceipt ?? JSON.stringify(options.receipt ?? { id: 'bot-1', kind: 'bot', exitCode: 0, delivery: 'accepted', messageId: 'm1' });
        }
        if (options.readError) throw new Error('synthetic-secret');
        return JSON.stringify(options.page ?? { target: { id: 'bot-1' }, transcript: { entries: options.entries ? options.entries(polls++) : [source, reply('r1', 'answer')] } });
      },
    },
  };
}

test('routes to a configured bot, preserves prompt, disables automatic return routing/history', async () => {
  const f = fixture(); const out = await thinkGbot(cfg, payload, f.deps);
  assert.match(out.text, /answer/); assert.match(out.text, /work may continue/); assert.equal(out.handoff, false);
  const send = f.calls.find(a => a[0] === 'send');
  assert.deepEqual(send.slice(0, 7), ['send', '--json', '--gateway', '--no-history', '--reply-mode', 'manual', 'bot-1']);
  assert.ok(send.at(-1).endsWith(payload.text));
});
test('ignores unrelated replies and private tools; waits for request correlation', async () => {
  const f = fixture({ entries: n => n === 0 ? [reply('other', 'private other chat')] : [source, {kind: 'tool-call', requestId: 'r1', text: 'secret tool'}, reply('other', 'private other chat'), reply('r1', 'right answer')] });
  const out = await thinkGbot(cfg, payload, f.deps);
  assert.match(out.text, /right answer/); assert.doesNotMatch(out.text, /private|secret/);
});
test('does not infer correlation from newest message when request id is missing', async () => {
  const f = fixture({ entries: () => [{ id: 'm1', kind: 'message' }, reply('other', 'private')] });
  const out = await thinkGbot(cfg, payload, f.deps);
  assert.match(out.text, /no correlated reply/); assert.doesNotMatch(out.text, /private/);
  assert.equal(f.calls.filter(a => a[0] === 'send').length, 1);
});
test('unknown send is never retried and raw failures never reach Discord', async () => {
  for (const options of [{sendError: true}, {receipt: {delivery: 'unknown'}}, {rawReceipt: 'synthetic-secret'}]) {
    const f = fixture(options); const out = await thinkGbot(cfg, payload, f.deps);
    assert.match(out.text, /unconfirmed/); assert.doesNotMatch(out.text, /synthetic-secret/);
    assert.equal(f.calls.filter(a => a[0] === 'send').length, 1);
    assert.equal(f.calls.filter(a => a[0] === 'thread').length, 1);
  }
});
test('unsupported CLI and group targets fail before send', async () => {
  for (const options of [{version:'0.2.2'}, {group:true}]) {
    const f = fixture(options); const out = await thinkGbot(cfg, payload, f.deps);
    assert.match(out.text, /No message was sent/); assert.ok(!f.calls.some(a => a[0] === 'send'));
  }
});
test('approval cards remain in Grok; sensitive card contents are not echoed', async () => {
  const f = fixture({ entries: () => [source, reply('r1', 'synthetic-secret', 'auto-review-approval')] });
  const out = await thinkGbot(cfg, payload, f.deps);
  assert.match(out.text, /needs your approval/); assert.doesNotMatch(out.text, /synthetic-secret/);
});
test('read failure after acceptance does not imply send failure', async () => {
  const f = fixture({ readError: true }); const out = await thinkGbot(cfg, payload, f.deps);
  assert.match(out.text, /accepted/); assert.doesNotMatch(out.text, /synthetic-secret/);
});
test('wrong target, invalid transcript, and lost history never leak text', async () => {
  for (const page of [
    {target:{id:'other'},transcript:{entries:[source,reply('r1','private')]}},
    {target:{id:'bot-1'},transcript:{other:'private'}},
    {target:{id:'bot-1'},transcript:{entries:Array.from({length:200},()=>reply('other','private'))}},
  ]) {
    const f = fixture({page}); const out = await thinkGbot(cfg, payload, f.deps);
    assert.match(out.text, /accepted/); assert.doesNotMatch(out.text, /private/);
  }
});
test('bounds reply output', async () => {
  const f = fixture({entries: () => [source,reply('r1','x'.repeat(20000))]});
  const out = await thinkGbot(cfg,payload,f.deps);
  assert.ok(out.text.length < 12500); assert.match(out.text,/shortened/);
});
test('subprocess passes literal arguments, suppresses inherited Codex route, and times out', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(),'gbot-test-'));
  const bin = path.join(dir,'fake-gbot');
  const old = process.env.CODEX_THREAD_ID;
  try {
    await writeFile(bin, '#!/usr/bin/env node\nif(process.argv[2]==="hang")setTimeout(()=>{},60000);else console.log(JSON.stringify({args:process.argv.slice(2),thread:process.env.CODEX_THREAD_ID,history:process.env.GROK_BOT_HISTORY}));\n', {mode:0o700});
    process.env.CODEX_THREAD_ID='must-not-propagate';
    const result=JSON.parse(await runGbot(bin,[payload.text],2000));
    assert.deepEqual(result.args,[payload.text]);assert.equal(result.thread,undefined);assert.equal(result.history,'off');
    await assert.rejects(()=>runGbot(bin,['hang'],100),/^Error: gbot command failed$/);
  } finally {
    if(old===undefined)delete process.env.CODEX_THREAD_ID;else process.env.CODEX_THREAD_ID=old;
    await rm(dir,{recursive:true,force:true});
  }
});
