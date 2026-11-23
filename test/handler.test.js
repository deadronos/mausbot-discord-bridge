import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {RateLimiter} from '../src/rateLimit.js';
import {splitMessage} from '../src/splitMessage.js';
import {isAllowedInGuild, formatReplyText} from '../src/handlerPure.js';
import {isAllowedDm} from '../src/dm.js';
// Exercise the actual entrypoint with no Discord socket or environment credentials.
const code=fs.readFileSync(new URL('../src/index.js',import.meta.url),'utf8').replace(/^#!.*\n/,'').replace(/^import[\s\S]*?from '[^']+';\n/gm,'');
function setup(overrides={}) {
 const cfg={token:'mock',guildAllow:new Set(['g']),channelAllow:new Set(['c']),authorAllow:new Set(['human','peer']),peerMentionId:'peer',requireBotMention:true,wakeWords:[],rateLimitPerUser:100,rateLimitWindowMs:60000,dedupeTtlSeconds:600,maxInflightPerChannel:1,logLevel:'error',...overrides};
 const handlers={},pending=[],calls=[],replies=[];
 let typingStopped=0;
 class Client {constructor(){this.user={id:'self'};}once(){}on(e,f){handlers[e]=f;}login(){return Promise.resolve();}destroy(){}}
 vm.runInNewContext(code,{Client,GatewayIntentBits:{},Partials:{},Events:{MessageCreate:'msg'},loadConfig:()=>cfg,think:(_cfg,payload)=>{calls.push(payload);return new Promise((resolve,reject)=>pending.push({resolve,reject}));},splitMessage,RateLimiter,isAllowedInGuild,formatReplyText,isAllowedDm,startTypingPulse:()=>()=>{typingStopped+=1;},watchLateReply:()=>false,console:{error(){},warn(){},info(){},log(){}},process:{on(){},exit(){}}});
 let id=0;
 return {calls,replies,pending,get typingStopped(){return typingStopped;},raw:(m)=>handlers.msg(m),send: (author='human',content='<@self> hello',messageId)=>handlers.msg({id:messageId||String(++id),guild:{id:'g'},author:{id:author,tag:author,bot:author==='peer'},content,mentions:{users:new Set(content.includes('<@self>')?['self']:[])},channel:{id:'c',sendTyping:async()=>{},send:async o=>replies.push(o)},reply:async o=>replies.push(o)})};
}
const tick=()=>new Promise(r=>setImmediate(r));
test('ignored/self/busy/duplicate messages cannot release another request slot',async()=>{
 const s=setup(); const first=s.send('human','<@self> first','first');await tick();
 await s.send('stranger');await s.send('self');await s.send('human','<@self> first','first');await s.send('human','<@self> second','second');
 assert.equal(s.calls.length,1);assert.match(s.replies[0].content,/not sent/);
 s.pending[0].resolve({text:'done',handoff:false});await first;
 const second=s.send('human','<@self> second','second');await tick();assert.equal(s.calls.length,2);s.pending[1].resolve({text:'done',handoff:false});await second;
});
test('preserves multiline input and suppresses gbot peer pings',async()=>{
 const s=setup();const p=s.send('human','<@self> ```py\n  code\n```');await tick();assert.equal(s.calls[0].text,'```py\n  code\n```');
 s.pending[0].resolve({text:'hello <@1234567890> @everyone',handoff:false});await p;
 assert.equal(s.replies[0].allowedMentions.parse.length,0);assert.equal(s.replies[0].allowedMentions.users.length,0);
 assert.doesNotMatch(s.replies[0].content,/<@1234567890>/);
});
test('human mention switch works while bot mention gate stays closed',async()=>{
 const s=setup({requireBotMention:false});await s.send('peer','no mention');assert.equal(s.calls.length,0);
 const p=s.send('human','no mention');await tick();assert.equal(s.calls.length,1);s.pending[0].resolve({text:'done'});await p;
});
test('errors are sanitized and release the owned slot',async()=>{
 const s=setup();const first=s.send();await tick();s.pending[0].reject(new Error('synthetic-secret'));await first;
 assert.doesNotMatch(s.replies[0].content,/synthetic-secret|<@peer>/);
 const second=s.send();await tick();assert.equal(s.calls.length,2);s.pending[1].resolve({text:'done'});await second;
});
function dm(s, author, content, bot=false) {
 // Reuse harness via a guildless message; harness `send` builds guild messages, so call handler through a DM-shaped object.
 return s.raw({id:String(Math.random()),guild:null,author:{id:author,tag:author,bot},content,mentions:{users:new Set()},channel:{id:'dmchan',type:1,recipients:[{id:author,bot}],sendTyping:async()=>{},send:async o=>s.replies.push(o)},reply:async o=>s.replies.push(o),react:async()=>{}});
}
test('DMs: disabled when DM allowlist empty; allowlisted humans pass without mention; bots and strangers dropped',async()=>{
 let s=setup();await dm(s,'human','hi');assert.equal(s.calls.length,0);
 s=setup({dmAllow:new Set(['human','peer'])});
 await dm(s,'stranger','hi');await dm(s,'peer','hi',true);assert.equal(s.calls.length,0);
 const p=dm(s,'human','hello there');await tick();assert.equal(s.calls.length,1);
 assert.equal(s.calls[0].isDM,true);assert.equal(s.calls[0].guildId,null);assert.equal(s.calls[0].channelId,'dmchan');
 s.pending[0].resolve({silent:true,handoff:false});await p;assert.equal(s.replies.length,0);
});


test('typing pulse is stopped when a turn finishes',async()=>{
  const s=setup();const p=s.send('human','<@self> hi');await tick();
  s.pending[0].resolve({text:'done',handoff:false});await p;
  assert.equal(s.typingStopped,1);
});

test('group DMs are dropped even when the author is allowlisted',async()=>{
  const s=setup({dmAllow:new Set(['human'])});
  await s.raw({id:'gdm1',guild:null,author:{id:'human',tag:'human',bot:false},content:'hello',mentions:{users:new Set()},channel:{id:'gdm',type:3,recipients:[{id:'human',bot:false},{id:'other',bot:false}],sendTyping:async()=>{},send:async o=>s.replies.push(o)},reply:async o=>s.replies.push(o),react:async()=>{}});
  assert.equal(s.calls.length,0);assert.equal(s.replies.length,0);
});

const pureCfg = {
  guildAllow: new Set(['g']),
  channelAllow: new Set(['c']),
  authorAllow: new Set(['owner']),
  peerMentionId: 'peer',
};
function guildMessage(authorId) {
  return { guild: { id: 'g' }, channel: { id: 'c' }, author: { id: authorId } };
}

test('drops a non-owner author in an allowed channel', () => {
  assert.equal(isAllowedInGuild(guildMessage('NOT-OWNER'), pureCfg, 'bot-id'), false);
  assert.equal(isAllowedInGuild(guildMessage('owner'), pureCfg, 'bot-id'), true);
});

test('ignores its own messages (pure gate)', () => {
  assert.equal(isAllowedInGuild(guildMessage('bot-id'), pureCfg, 'bot-id'), false);
});

test('drops messages from a non-allowed channel or guild', () => {
  const wrongChannel = { guild: { id: 'g' }, channel: { id: 'other' }, author: { id: 'owner' } };
  const wrongGuild = { guild: { id: 'other' }, channel: { id: 'c' }, author: { id: 'owner' } };
  assert.equal(isAllowedInGuild(wrongChannel, pureCfg, 'bot-id'), false);
  assert.equal(isAllowedInGuild(wrongGuild, pureCfg, 'bot-id'), false);
});

test('reply never pings mentioned users and appends no peer mention', () => {
  const text = formatReplyText({ text: 'hi <@123> and <@!456>', handoff: false }, pureCfg);
  assert.match(text, /@user:123/);
  assert.match(text, /@user:456/);
  assert.doesNotMatch(text, /<@/);
  assert.doesNotMatch(text, /<@peer>/);
});

test('allowlisted peer mentions stay real, unknown mentions are neutralized', () => {
  const cfg = { ...pureCfg, mentionAllow: new Set(['123']) };
  const text = formatReplyText({ text: 'hi <@123> and <@!456>', handoff: false }, cfg);
  assert.match(text, /<@123>/);
  assert.match(text, /@user:456/);
  assert.doesNotMatch(text, /<@!456>/);
  assert.doesNotMatch(text, /<@peer>/);
});

test('allowlisted mentions keep ping syntax and are permitted in allowedMentions', async () => {
  const s = setup({ mentionAllow: new Set(['123']) });
  const p = s.send('human', '<@self> hello');
  await tick();
  s.pending[0].resolve({ text: 'hi <@123> <@456> @everyone', handoff: false });
  await p;
  assert.match(s.replies[0].content, /<@123>/);
  assert.doesNotMatch(s.replies[0].content, /<@456>/);
  assert.equal(s.replies[0].allowedMentions.users.length, 1);
  assert.equal(s.replies[0].allowedMentions.users[0], '123');
  assert.equal(s.replies[0].allowedMentions.parse.length, 0);
});

test('long reply is split into ordered complete chunks', () => {
  const long = 'a'.repeat(4200);
  const chunks = splitMessage(long, 1900);
  assert.equal(chunks.length, 3);
  assert.equal(chunks.join(''), long);
});
