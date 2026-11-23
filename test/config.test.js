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
test('mausbot mode requires exactly the owner in the author allowlist',()=>{
  assert.throws(()=>config({...mausbot,DISCORD_AUTHOR_ALLOWLIST:'owner-1,other'}),/DISCORD_AUTHOR_ALLOWLIST/);
  assert.throws(()=>config({...mausbot,DISCORD_AUTHOR_ALLOWLIST:'other'}),/DISCORD_AUTHOR_ALLOWLIST/);
});
test('mausbot mode does not require DISCORD_PEER_MENTION_ID',()=>{
  assert.equal(config(mausbot).brainMode,'mausbot');
});
test('mausbot mode supports a DM allowlist',()=>{
  assert.equal(config({...mausbot,DISCORD_DM_ALLOWLIST:'owner-1'}).dmAllow.has('owner-1'),true);
});
