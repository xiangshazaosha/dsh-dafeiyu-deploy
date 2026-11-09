import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import module from '../assets/breeze-voice/index.mjs';
import {PRESETS,presetOf,validateText,wavBuffer,readSourceWav,readRuntime,runtimeOptions,createService} from '../assets/breeze-voice/service.mjs';
const root=mkdtempSync(join(tmpdir(),'dafeiyu-breeze-test-'));
mkdirSync(join(root,'voices'));mkdirSync(join(root,'samples'));
const runtime={root,exe:'runtime/server.exe',model:'models/model.gguf',sourceRoots:[join(root,'samples')]};
writeFileSync(join(root,'breeze-runtime.json'),JSON.stringify(runtime));

test('runtime is configurable and cannot escape the selected root',()=>{
 assert.equal(readRuntime(root).base,'http://127.0.0.1:18370');
 assert.throws(()=>runtimeOptions({...runtime,exe:'../external.exe'}));
 assert.throws(()=>runtimeOptions({...runtime,port:80}));
 assert.equal(runtimeOptions(runtime).disableCoopmat,false);
});
test('four synthetic presets and text validation',()=>{
 assert.equal(PRESETS.length,4);assert.equal(presetOf('晚宁').id,'wanning');assert.equal(presetOf('../x'),undefined);
 assert.throws(()=>validateText(''));assert.throws(()=>validateText('x'.repeat(1201)));
});
test('WAV parsing uses byte rate, bounds duration and rejects outside paths',()=>{
 const file=join(root,'samples/input.wav');writeFileSync(file,wavBuffer(Buffer.alloc(48000)));
 assert.equal(readSourceWav(file,runtime.sourceRoots).seconds,1);
 assert.throws(()=>readSourceWav(join(root,'breeze-runtime.json'),runtime.sourceRoots));
 const malformed=wavBuffer(Buffer.alloc(48000));malformed.writeUInt32LE(1,28);writeFileSync(file,malformed);
 assert.throws(()=>readSourceWav(file,runtime.sourceRoots));
 assert.throws(()=>wavBuffer(Buffer.alloc(2401)));
});
test('disposed service never falls back to another engine',async()=>{
 let dispose;const s=createService({runtime,onDispose:fn=>dispose=fn});dispose();await assert.rejects(s.synth('你好','qinglan'),/停用/);
});
test('wrapper keeps legacy ASR, speech-only switch and opt-out',async()=>{
 const routes=new Map(),commands=new Map(),dispose=[];let settings={...module.defaults,breezeRoot:root};
 const legacy={speak:async()=>({engine:'legacy'}),edgeInstalled:()=>true};
 const api={settings:()=>settings,saveSettings:p=>{settings={...settings,...p}},log:{},onDispose:fn=>dispose.push(fn),lib:()=>({default:{setup:a=>{a.route('/voice/asr-status',()=>true);a.route('/voice/test',()=>{});return legacy;}}}),route:(p,f)=>routes.set(p,f),command:c=>commands.set(c.name,c),core:{http:{body:async r=>r}},dataDir:()=>root};
 const out=module.setup(api);assert(routes.has('/voice/asr-status'));assert(routes.has('/breeze/select'));
 commands.get('音色').run('晚宁');assert.equal(settings.breezeVoice,'wanning');assert.throws(()=>commands.get('音色').run('unknown'));
 settings.breezeEnabled=false;assert.equal((await out.speak('测试')).engine,'legacy');dispose.forEach(fn=>fn());
});
test('local protocol mock produces valid audio with selected voice',async()=>{
 const received=[];
 const server=createServer(async(req,res)=>{
  if(req.url==='/health'){res.setHeader('content-type','application/json');res.end(JSON.stringify({status:'ok',sample_rate:24000}));return;}
  let body='';for await(const b of req)body+=b;received.push(JSON.parse(body));
  res.setHeader('content-type','audio/pcm');res.end(Buffer.alloc(4800));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 let dispose;
 try{
  writeFileSync(join(root,'voices/qinglan.breeze'),'synthetic test fixture');
  const s=createService({runtime:{...runtime,port:server.address().port},onDispose:fn=>dispose=fn});
  const out=await s.synth('本机协议测试','qinglan');assert.equal(readFileSync(out.file).toString('ascii',0,4),'RIFF');assert.equal(received[0].voice,'qinglan');assert.equal(out.engine,'breeze-tts2-vulkan');
 }finally{dispose?.();await new Promise(r=>server.close(r));}
});
test('missing runtime config cannot silently restore an online engine',async()=>{
 let legacyCalls=0;
 const api={settings:()=>({breezeEnabled:true,breezeRoot:join(root,'missing')}),log:{},onDispose:()=>{},lib:()=>({default:{setup:()=>({speak:async()=>{legacyCalls++}})}}),route:()=>{},command:()=>{},core:{http:{body:async r=>r}},dataDir:()=>root};
 const out=module.setup(api);await assert.rejects(out.speak('本机配置损坏'),/不自动改用/);assert.equal(legacyCalls,0);
});
