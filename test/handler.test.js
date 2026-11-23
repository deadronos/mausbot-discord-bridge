import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {RateLimiter} from '../src/rateLimit.js';
import {splitMessage} from '../src/splitMessage.js';
// Exercise the actual entrypoint with no Discord socket or environment credentials.
const code=fs.readFileSync(new URL('../src/index.js',import.meta.url),'utf8').replace(/^#!.*\n/,'').replace(/^import[\s\S]*?from '[^']+';\n/gm,'');
function setup(overrides={}) {
 const cfg={token:'mock',guildAllow:new Set(['g']),channelAllow:new Set(['c']),authorAllow:new Set(['human','peer']),peerMentionId:'peer',requireBotMention:true,wakeWords:[],rateLimitPerUser:100,rateLimitWindowMs:60000,dedupeTtlSeconds:600,maxInflightPerChannel:1,logLevel:'error',...overrides};
 const handlers={},pending=[],calls=[],replies=[];
 class Client {constructor(){this.user={id:'self'};}once(){}on(e,f){handlers[e]=f;}login(){return Promise.resolve();}destroy(){}}
 vm.runInNewContext(code,{Client,GatewayIntentBits:{},Partials:{},Events:{MessageCreate:'msg'},loadConfig:()=>cfg,think:(_cfg,payload)=>{calls.push(payload);return new Promise((resolve,reject)=>pending.push({resolve,reject}));},splitMessage,RateLimiter,console:{error(){},warn(){},info(){},log(){}},process:{on(){},exit(){}}});
 let id=0;
 return {calls,replies,pending,raw:(m)=>handlers.msg(m),send: (author='human',content='<@self> hello',messageId)=>handlers.msg({id:messageId||String(++id),guild:{id:'g'},author:{id:author,tag:author,bot:author==='peer'},content,mentions:{users:new Set(content.includes('<@self>')?['self']:[])},channel:{id:'c',sendTyping:async()=>{},send:async o=>replies.push(o)},reply:async o=>replies.push(o)})};
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
 return s.raw({id:String(Math.random()),guild:null,author:{id:author,tag:author,bot},content,mentions:{users:new Set()},channel:{id:'dmchan',sendTyping:async()=>{},send:async o=>s.replies.push(o)},reply:async o=>s.replies.push(o),react:async()=>{}});
}
test('DMs: disabled when DM allowlist empty; allowlisted humans pass without mention; bots and strangers dropped',async()=>{
 let s=setup();await dm(s,'human','hi');assert.equal(s.calls.length,0);
 s=setup({dmAllow:new Set(['human','peer'])});
 await dm(s,'stranger','hi');await dm(s,'peer','hi',true);assert.equal(s.calls.length,0);
 const p=dm(s,'human','hello there');await tick();assert.equal(s.calls.length,1);
 assert.equal(s.calls[0].isDM,true);assert.equal(s.calls[0].guildId,null);assert.equal(s.calls[0].channelId,'dmchan');
 s.pending[0].resolve({silent:true,handoff:false});await p;assert.equal(s.replies.length,0);
});
