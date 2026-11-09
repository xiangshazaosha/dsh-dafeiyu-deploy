// Optional integration test against an installed Aurabot. No real gateway calls.
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {formatReplyItems} from '../assets/voice-controls/index.mjs';
import {wavBuffer} from '../assets/breeze-voice/service.mjs';
const i=process.argv.indexOf('--plugin-dir');if(i<0)throw Error('Required: --plugin-dir with the installed Aurabot package');
const root=mkdtempSync(join(tmpdir(),'dafeiyu-hub-test-'));
process.env.AURABOT_DATA_DIR=root;
const base=pathToFileURL(join(resolve(process.argv[i+1]),'src')+'/').href;
const {createHub}=await import(base+'chat/hub.js');
const {DEFAULTS}=await import(base+'core/config.js');
const fixture=join(root,'mock-speech.wav');writeFileSync(fixture,wavBuffer(Buffer.alloc(4800)));
const cfg=structuredClone(DEFAULTS);cfg.enabled=true;cfg.dryRun=false;cfg.voice.enabled=true;cfg.voice.autoChance=0;cfg.stickers.enabled=false;cfg.stickers.faces=false;
let mode='auto',ttsCalls=0,gatewayCalls=0,failTts=false;
const log=Object.fromEntries(['info','warn','debug','error'].map(k=>[k,()=>{}]));
const hub=createHub({getConfig:()=>cfg,dsh:{get:()=>undefined},log,onebot:{call:async()=>{gatewayCalls++;throw Error('Real QQ is forbidden')}},stickers:{},tts:{speak:async()=>{ttsCalls++;if(failTts)throw Error('test synthesis failure');return{file:fixture,engine:'local-test-fixture'}}},hooks:{items:items=>formatReplyItems(items,mode)}});
const results=[];
try{
 for(const [m,input,expected] of [['text','<voice>你好呀</voice>',['text']],['voice','你好呀',['record']],['both','你好呀',['text','record']],['auto','你好呀',['text']]]){
  mode=m;const before=ttsCalls;const cap=await hub.capture(()=>hub.deliver('private:10000',input,{simulate:true}));
  const types=cap.sent.flatMap(x=>x.message.map(s=>s.type));assert.deepEqual(types,expected);if(m==='text')assert.equal(ttsCalls,before);results.push({mode:m,types});
 }
 mode='voice';failTts=true;const failed=await hub.capture(()=>hub.deliver('private:10000','语音失败也不丢回复',{simulate:true}));
 assert.deepEqual(failed.sent.flatMap(x=>x.message.map(s=>s.type)),['text']);assert.equal(gatewayCalls,0);
 console.log(JSON.stringify({ok:true,results,failureFallback:'text',gatewayCalls}));
}finally{hub.disposeRecentMedia();}
