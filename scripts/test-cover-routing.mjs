import {pathToFileURL} from 'node:url';
const REVIEWED_PLUGIN=process.env.DSH_AURABOT_PLUGIN_DIR;
// All I/O below is temporary fixture data. Never uses real QQ, songs, networks or inference.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createQQRouter,installNativeGuard,chooseCandidate,cleanQuery,NATIVE_GUARD} from '../assets/breeze-cover/qq-router.mjs';
import {installRequestGuard} from '../assets/song-library/request-guard.mjs';
import library from '../assets/song-library/index.mjs';
import controls from '../assets/voice-controls/index.mjs';
const flush=()=>new Promise(r=>setImmediate(r));
function fixture(t,{candidates=[{id:123,name:'夜曲',artists:'周杰伦'}]}={}){
 const dir=mkdtempSync(join(tmpdir(),'cover-routing-'));const cfg={enabled:true,dryRun:false,ownerQQ:'fixture-owner',song:{enabled:true,voice:'rvc-fixture',root:'fixture-root'},ext:{voice:{breezeVoice:'speech-keep'},'voice-controls':{replyMode:'voice'},'breeze-cover':{engine:'breeze'}}};
 const calls={starts:[],texts:[],voices:[],native:[],files:[]},jobs=new Map();let nativeBusy=false,localBusy=false,ready=true;
 const studio={state:()=>({ok:true,engine:cfg.ext['breeze-cover'].engine,selectedVoice:'female',qqDurationSec:10,breezeArrangement:'acappella',rvcArrangement:'mixed',rvcVoice:'rvc-fixture',keepMelody:1,ready,busy:localBusy,voices:[{id:'female',name:'女声'}],rvcVoices:[{id:'rvc-fixture'}],sources:[],jobs:[]}),search:async()=>({list:candidates}),start:spec=>{if(nativeBusy)throw Error('原RVC正在制作');calls.starts.push(spec);const id='job-'+calls.starts.length,job={id,...spec,status:'queued',seconds:10};jobs.set(id,job);return {ok:true,job};},status:id=>({job:jobs.get(id)}),resultFile:(id,a)=>{calls.files.push({id,a});return join(dir,id+'-'+a+'.mp3');}};
 const router=createQQRouter({root:dir,getConfig:()=>cfg,studio,sendText:async(...a)=>{calls.texts.push(a);},sendVoice:async(...a)=>{calls.voices.push(a);}});
 t.after(()=>{router.dispose();rmSync(dir,{recursive:true,force:true});});
 return {dir,cfg,calls,studio,router,jobs,setReady:v=>ready=v,setNativeBusy:v=>nativeBusy=v,setLocalBusy:v=>localBusy=v};
}
const args=(song='周杰伦 夜曲 清唱')=>({song,chatId:'private:fixture-owner'});
test('Breeze requests never enter old RVC, use selected voice/variant and deduplicate pending calls',async t=>{
 const f=fixture(t);const a=f.router.intercept(args()),b=f.router.intercept(args());assert.equal(a.handled,true);assert.equal(b.result.reused,true);assert.equal(a.result.requestId,b.result.requestId);await flush();
 assert.equal(f.calls.starts.length,1);assert.equal(f.calls.starts[0].engine,'breeze');assert.equal(f.calls.starts[0].voice,'female');assert.equal(f.calls.starts[0].arrangement,'acappella');assert.equal(f.calls.voices.length,0);
 assert.equal(f.router.intercept(args('RVC 另一首')).result.ok,false);
});
test('only the correct completed Breeze artifact is submitted once, with auditable metadata',async t=>{
 const f=fixture(t);f.router.intercept(args());await flush();f.jobs.get('job-1').status='done';await f.router.tick();await f.router.tick();
 assert.equal(f.calls.voices.length,1);assert.match(f.calls.voices[0][1],/job-1-acappella/);assert.match(f.calls.voices[0][2],/Breeze CPP.*女声.*清唱/);assert.deepEqual(f.calls.files,[{id:'job-1',a:'acappella'}]);
 assert.equal(f.router.status().requests[0].actualEngine,'breeze');assert.equal(f.router.status().requests[0].actualVoice,'female');
 assert.equal(f.router.intercept(args()).result.reused,true);await flush();assert.equal(f.calls.starts.length,1);assert.equal(f.calls.voices.length,1);
});
test('a mismatched RVC artifact is blocked rather than relabelled Breeze',async t=>{
 const f=fixture(t);f.router.intercept(args());await flush();Object.assign(f.jobs.get('job-1'),{status:'done',engine:'rvc',voice:'rvc-fixture'});await f.router.tick();assert.equal(f.calls.voices.length,0);assert.equal(f.router.status().requests[0].status,'failed');assert.match(f.router.status().requests[0].message,/引擎或音色/);
});
test('not ready, invalid voice, whole-song requests and dry-run never queue fallback work',async t=>{
 const f=fixture(t);f.setReady(false);assert.match(f.router.intercept(args()).result.message,/不会自动改用RVC/);f.setReady(true);
 assert.equal(f.router.intercept({...args(),voice:'rvc-fixture'}).result.ok,false);assert.equal(f.router.intercept(args('夜曲 整首')).result.ok,false);assert.equal(f.router.intercept(args('Breeze RVC 夜曲')).result.ok,false);
 f.cfg.dryRun=true;assert.equal(f.router.intercept(args()).result.queued,false);await flush();assert.equal(f.calls.starts.length,0);assert.equal(f.calls.voices.length,0);
});
test('native work in progress blocks the new conversion; rapid model retries do not create new failed jobs',async t=>{
 const f=fixture(t);f.setNativeBusy(true);f.router.intercept(args());await flush();assert.equal(f.calls.starts.length,0);assert.equal(f.router.status().requests[0].status,'failed');
 const retry=f.router.intercept(args());assert.equal(retry.result.ok,false);assert.equal(retry.result.reused,true);await flush();assert.equal(f.router.status().requests.length,1);assert.equal(f.calls.voices.length,0);
});
test('ambiguous song versions wait for an explicit choice and continue the same request once',async t=>{
 const f=fixture(t,{candidates:[{id:11,name:'测试合唱',artists:'歌手甲 / 歌手乙'},{id:22,name:'测试合唱',artists:'歌手甲 / 歌手丙'}]});const r=f.router.intercept(args('测试合唱 歌手甲'));await flush();assert.equal(f.calls.starts.length,0);assert.equal(f.router.status().requests[0].status,'needs_choice');assert.match(f.calls.texts[0][1],/coverpick/);
 const chosen=f.router.choose(r.result.requestId,1);assert.equal(chosen.ok,true);assert.equal(f.calls.starts.length,1);assert.equal(f.calls.starts[0].songId,'11');assert.throws(()=>f.router.choose(r.result.requestId,1),/未重复制作/);
});
test('reconfiguration before sending prevents delivery; interrupted requests do not auto-resend',async t=>{
 const f=fixture(t);f.router.intercept(args());await flush();f.jobs.get('job-1').status='done';f.cfg.dryRun=true;await f.router.tick();assert.equal(f.calls.voices.length,0);
 f.cfg.dryRun=false;f.router.intercept(args('周杰伦 夜曲 带伴奏'));await flush();
 const fresh=createQQRouter({root:f.dir,getConfig:()=>f.cfg,studio:f.studio,sendText:async()=>{throw Error('unexpected send');},sendVoice:async()=>{throw Error('unexpected send');}});assert(fresh.status().requests.some(x=>x.status==='interrupted'));assert.equal(fresh.active(),false);await fresh.tick();fresh.dispose();
});
test('an uncertain gateway response is not retried',async t=>{
 const f=fixture(t);f.router.dispose();let attempts=0;
 const r=createQQRouter({root:f.dir,getConfig:()=>f.cfg,studio:f.studio,sendText:async()=>{},sendVoice:async()=>{attempts++;throw Error('uncertain');}});r.intercept(args());await flush();f.jobs.get('job-1').status='done';await r.tick();await r.tick();assert.equal(attempts,1);assert.equal(r.status().requests[0].status,'delivery_uncertain');r.dispose();
});
test('RVC explicit/default requests pass through when idle, but non-owner Breeze is never redirected to owner',t=>{
 const f=fixture(t);assert.equal(f.router.intercept(args('RVC 夜曲')).handled,false);f.cfg.ext['breeze-cover'].engine='rvc';assert.equal(f.router.intercept(args('夜曲')).handled,false);
 const foreign=f.router.intercept({song:'Breeze 夜曲',chatId:'private:someone-else'});assert.equal(foreign.handled,true);assert.equal(foreign.result.ok,false);assert.equal(f.calls.starts.length,0);
 f.setLocalBusy(true);assert.equal(f.router.intercept({song:'夜曲',chatId:'group:fixture'}).result.ok,false);
});
test('outer native routing and inner library guard remain stable in either load order and restore cleanly',async t=>{
 for(const order of ['cover-first','library-first']){
  const f=fixture(t);let resolved=0,played=0;const offs=[],intervals=[],handlers=[];
  const native=(a)=>{f.calls.native.push(a);return {ok:true,queued:true};},song={request:native};
  const api={config:()=>f.cfg,use:id=>id==='song'?song:null,log:{warn:()=>{},info:()=>{}},on:(e,fn)=>handlers.push([e,fn]),onDispose:fn=>offs.push(fn),every:(ms,fn)=>intervals.push(fn)};
  const lib=()=>installRequestGuard(api,()=>{resolved++;return {kind:'none'};},async()=>{played++;});
  if(order==='cover-first'){installNativeGuard(api,f.router);lib();}else{lib();installNativeGuard(api,f.router);}
  const outer=song.request;assert(outer[NATIVE_GUARD]);for(let i=0;i<5;i++)for(const fn of intervals)fn();assert.equal(song.request,outer);
  song.request(args());await flush();assert.equal(resolved,0);assert.equal(played,0);assert.equal(f.calls.native.length,0);assert.equal(f.calls.starts.length,1);
  for(const off of offs.reverse())off();assert.equal(song.request,native);
 }
});
test('song-library message and slash-command entry cannot send old RVC cache under Breeze default',async t=>{
 const f=fixture(t),events=new Map(),commands=new Map(),song={request:a=>f.router.intercept(a).result};
 const api={config:()=>f.cfg,use:id=>id==='breeze-cover'?{resolveEngine:f.router.resolveEngine}:song,isOwner:id=>id===f.cfg.ownerQQ,on:(n,fn)=>events.set(n,fn),onDispose:()=>{},every:()=>{},route:()=>{},context:()=>{},log:{warn:()=>{},info:()=>{}},command:c=>commands.set(c.name,c),sendText:async()=>{throw Error('Old library must not send');},sendVoiceFile:async()=>{throw Error('Old RVC cache must not play');}};
 library.setup(api);installNativeGuard(api,f.router);const msg={kind:'private',userId:'fixture-owner',chatId:'private:fixture-owner',text:'唱夜曲',raw:{}};
 assert.equal(await events.get('message')(msg),false);const result=await commands.get('sing').run('周杰伦 夜曲 清唱',msg);await flush();assert.match(result,/Breeze|BREEZE/);assert.equal(f.calls.starts.length,1);assert.equal(f.calls.voices.length,0);
});
test('song query cleanup preserves title and artist; no implicit first-result choice',()=>{
 assert.equal(cleanQuery('来首周杰伦的彩虹 清唱'),'周杰伦的彩虹');assert.equal(chooseCandidate('遇见',[{name:'遇见',artists:'甲'},{name:'遇见',artists:'乙'}]),null);assert.equal(chooseCandidate('周杰伦 夜曲',[{id:1,name:'夜曲',artists:'周杰伦'},{id:2,name:'夜曲',artists:'翻唱者'}]).id,1);
});
test('installed real qq_song_cover tool reaches the unified Breeze route, with native RVC queue untouched',{skip:!REVIEWED_PLUGIN},async t=>{
 const f=fixture(t),old=process.env.AURABOT_DATA_DIR;process.env.AURABOT_DATA_DIR=f.dir;f.cfg.song.root=f.dir;f.cfg.song.separatorModel='fixture.ckpt';let native,builder;
 try{
  const definition=(await import(pathToFileURL(join(REVIEWED_PLUGIN,'src/modules/song/index.js')).href)).default;
  const api={config:()=>f.cfg,core:{hub:{turnHasOwner:()=>true,sendVoiceFile:async()=>{throw Error('Real gateway forbidden');},sendText:async()=>{throw Error('Real gateway forbidden');}},local:{active:()=>false},http:{}},lazy:()=>({}),log:{info:()=>{},warn:()=>{},debug:()=>{}},tool:fn=>{builder=fn;},route:()=>{},use:()=>native,on:()=>{},every:()=>{},onDispose:()=>{}};
  native=definition.setup(api);installNativeGuard(api,f.router);
  const tool=builder({chat:{kind:'private',chatId:'private:fixture-owner'},sessionId:'fixture'});assert.equal(tool.name,'qq_song_cover');
  const r=await tool.execute({song:'周杰伦 夜曲 清唱',pitch:0});await flush();assert.equal(r.ok,true);assert.equal(r.engine,'breeze');assert.equal(f.calls.starts.length,1);assert.equal(native.status().current,null);assert.deepEqual(native.status().queue,[]);assert.equal(f.calls.voices.length,0);
 }finally{if(old===undefined)delete process.env.AURABOT_DATA_DIR;else process.env.AURABOT_DATA_DIR=old;}
});
