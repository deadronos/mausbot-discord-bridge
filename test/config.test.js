import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../src/config.js',import.meta.url),'utf8').replace(/^import.*\n/gm,'').replace('export function loadConfig','function loadConfig');
const base={DISCORD_BOT_TOKEN:'fake-token-for-config-only',DISCORD_GUILD_ALLOWLIST:'g',DISCORD_CHANNEL_ALLOWLIST:'c',DISCORD_AUTHOR_ALLOWLIST:'human',BRAIN_MODE:'gbot',GBOT_TARGET_ID:'bot-1'};
function config(overrides={}) {
 const context=vm.createContext({fs,path,dotenv:{config(){}},process:{env:{...base,...overrides}}});
 vm.runInContext(source,context);return vm.runInContext('loadConfig()',context);
}
test('gbot config needs no API key or peer mention and defaults to bounded wait',()=>{
 const c=config();assert.equal(c.gbot.timeoutMs,120000);assert.equal(c.gbot.target,'bot-1');assert.equal(c.peerMentionId,'');
});
test('gbot refuses broad channel scope and invalid command target',()=>{
 for(const o of [{DISCORD_CHANNEL_ALLOWLIST:'c,d'},{DISCORD_GUILD_ALLOWLIST:'g,h'},{GBOT_TARGET_ID:'--help'},{GBOT_TARGET_ID:'Bot Name'},{GBOT_TARGET_ID:''}]) assert.throws(()=>config(o));
});
test('gbot validates bounds and requires one inflight request',()=>{
 for(const o of [{GBOT_TIMEOUT_MS:'0'},{GBOT_TIMEOUT_MS:'300001'},{GBOT_POLL_MS:'0'},{GBOT_POLL_MS:'1.5'},{MAX_INFLIGHT_PER_CHANNEL:'2'}])assert.throws(()=>config(o));
});
test('legacy backends retain their peer requirement',()=>{
 assert.throws(()=>config({BRAIN_MODE:'log_only'}),/DISCORD_PEER_MENTION_ID/);
 assert.equal(config({BRAIN_MODE:'log_only',DISCORD_PEER_MENTION_ID:'peer'}).brainMode,'log_only');
});

const mausbot={BRAIN_MODE:'mausbot',DISCORD_OWNER_ID:'owner-1',DISCORD_AUTHOR_ALLOWLIST:'owner-1',MAUSBOT_API_BASE:'https://maus.example/api',MAUSBOT_API_KEY:'maus-key-xyz'};
test('mausbot mode is accepted with its api key',()=>{
  const c=config(mausbot);
  assert.equal(c.brainMode,'mausbot');
  assert.equal(c.mausbot.apiKey,'maus-key-xyz');
  assert.equal(c.mausbot.apiBase,'https://maus.example/api');
});
test('mausbot mode requires MAUSBOT_API_KEY',()=>{
  const o={...mausbot};delete o.MAUSBOT_API_KEY;
  assert.throws(()=>config(o),/MAUSBOT_API_KEY/);
});
test('mausbot mode requires DISCORD_OWNER_ID',()=>{
  const o={...mausbot};delete o.DISCORD_OWNER_ID;
  assert.throws(()=>config(o),/DISCORD_OWNER_ID/);
});
test('mausbot mode requires the owner and rejects unlisted authors',()=>{
  assert.throws(()=>config({...mausbot,DISCORD_AUTHOR_ALLOWLIST:'other'}),/DISCORD_AUTHOR_ALLOWLIST/);
  assert.throws(()=>config({...mausbot,DISCORD_AUTHOR_ALLOWLIST:'owner-1,stranger',DISCORD_PEER_AUTHOR_ALLOWLIST:'peer-1'}),/DISCORD_AUTHOR_ALLOWLIST/);
});
test('mausbot mode accepts explicitly named peer authors',()=>{
  const c=config({...mausbot,DISCORD_AUTHOR_ALLOWLIST:'owner-1,peer-1,peer-2',DISCORD_PEER_AUTHOR_ALLOWLIST:'peer-1,peer-2'});
  assert.deepEqual([...c.authorAllow].sort(),['owner-1','peer-1','peer-2']);
  assert.deepEqual([...c.peerAuthorAllow].sort(),['peer-1','peer-2']);
});
test('mausbot mode does not require DISCORD_PEER_MENTION_ID',()=>{
  assert.equal(config(mausbot).brainMode,'mausbot');
});
test('typing pulse interval is bounded',()=>{
  assert.equal(config(mausbot).typingPulseMs,5000);
  assert.equal(config({...mausbot,TYPING_PULSE_MS:'4000'}).typingPulseMs,4000);
  assert.throws(()=>config({...mausbot,TYPING_PULSE_MS:'200'}),/TYPING_PULSE_MS/);
  assert.throws(()=>config({...mausbot,TYPING_PULSE_MS:'60000'}),/TYPING_PULSE_MS/);
});
test('late reply window is bounded',()=>{
  assert.equal(config(mausbot).mausbot.lateReplyTimeoutMs,900000);
  assert.equal(config({...mausbot,MAUSBOT_LATE_REPLY_MS:'60000'}).mausbot.lateReplyTimeoutMs,60000);
  assert.throws(()=>config({...mausbot,MAUSBOT_LATE_REPLY_MS:'1000'}),/MAUSBOT_LATE_REPLY_MS/);
});
test('send API port is bounded and secret is optional',()=>{
  assert.equal(config(mausbot).sendApi.port,8812);
  assert.equal(config(mausbot).sendApi.secret,'');
  assert.equal(config({...mausbot,SEND_API_PORT:'9000',MAUSBOT_SEND_API_SECRET:'s'}).sendApi.port,9000);
  assert.throws(()=>config({...mausbot,SEND_API_PORT:'80',MAUSBOT_SEND_API_SECRET:'s'}),/SEND_API_PORT/);
});
test('mausbot mode supports a DM allowlist',()=>{
  assert.equal(config({...mausbot,DISCORD_DM_ALLOWLIST:'owner-1'}).dmAllow.has('owner-1'),true);
});
