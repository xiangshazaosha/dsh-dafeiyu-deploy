// Offline fixtures only. No QQ, network, real songs, models or service startup.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import controls from '../assets/voice-controls/index.mjs';
import definition from '../assets/breeze-cover/index.mjs';
import {createStudio,wavInfo} from '../assets/breeze-cover/studio.mjs';
const merge=(a,b)=>{for(const [k,v]of Object.entries(b))a[k]=v&&typeof v==='object'&&!Array.isArray(v)?merge(a[k]||{},v):v;return a;};
function fixture(t){
 const cleanup=[];const dir=mkdtempSync(join(tmpdir(),'dafeiyu-cover-test-'));t.after(()=>{for(const fn of cleanup)fn();rmSync(dir,{recursive:true,force:true});});
 const root=join(dir,'module-data'),work=join(dir,'songs'),rvc=join(dir,'existing-rvc'),workspace=join(dir,'workspace');
 for(const d of [root,work,workspace,join(rvc,'bin'),join(rvc,'env/Scripts'),join(rvc,'separator-models')])mkdirSync(d,{recursive:true});
 for(const p of ['bin/ffmpeg.exe','env/Scripts/python.exe','separator-models/test.ckpt','separator-models/test.yaml'])writeFileSync(join(rvc,p),'fixture, not executable');
 const cfg={enabled:true,dryRun:false,ownerQQ:'fixture-owner',song:{root:rvc,voice:'rvc-fixture',separatorModel:'test.ckpt'},workspaceDir:workspace,ext:{voice:{breezeVoice:'speech-keep'},'voice-controls':{replyMode:'voice'},'breeze-cover':{}}};
 const breeze={breezeVoices:()=>[{id:'sajiao_text_v2',name:'女声'}],breezeConvert:()=>{throw Error('Real conversion forbidden in tests');}};
 const song={status:()=>({voices:[{id:'rvc-fixture'}]}),convertSpeech:()=>{throw Error('Real conversion forbidden in tests');}};
 const opts={root,songWork:work,workspace,worker:'unused',getConfig:()=>cfg,getSettings:()=>cfg.ext['breeze-cover'],saveSettings:p=>merge(cfg.ext['breeze-cover'],p),getBreeze:()=>breeze,getSong:()=>song,resolveSongUrl:async()=>{throw Error('Network forbidden');},search:async()=>[]};
 return {dir,root,work,cfg,opts,cleanup};
}
function render(source,values){
 const React={Fragment:'Fragment',useState:initial=>[values.length?values.shift():initial,()=>{}],useEffect:()=>{}},h=(type,props,...children)=>({type,props,children}),ui=Object.fromEntries(['Card','Btn','Row','Select'].map(k=>[k,k]));
 const Component=new Function('React','h','ui','call',readFileSync(source,'utf8'))(React,h,ui,async()=>{throw Error('UI network forbidden');});
 const tree=Component({toast:()=>{},reload:()=>{}}),flat=[];const walk=x=>{if(x&&typeof x==='object'){flat.push(x);(x.children||[]).flat(Infinity).forEach(walk);}};walk(tree);return flat;
}
test('independent defaults, invalid voices/versions, no queue on invalid input',t=>{
 const f=fixture(t),s=createStudio(f.opts);f.cleanup.push(()=>s.dispose());
 s.selectSettings({voice:'sajiao_text_v2',breezeArrangement:'acappella',rvcArrangement:'mixed',keepMelody:2});
 assert.equal(s.state().breezeArrangement,'acappella');assert.equal(s.state().rvcArrangement,'mixed');
 assert.equal(f.cfg.ext.voice.breezeVoice,'speech-keep');assert.equal(f.cfg.song.voice,'rvc-fixture');
 const before=JSON.stringify(f.cfg);assert.throws(()=>s.selectSettings({breezeArrangement:'invalid'}));assert.throws(()=>s.selectSettings({voice:'unknown'}));assert.equal(JSON.stringify(f.cfg),before);
 assert.throws(()=>s.start({durationSec:181}));assert.throws(()=>s.start({arrangement:'invalid'}));assert.throws(()=>s.start({file:join(f.dir,'outside.mp3')}));assert.equal(s.state().jobs.length,0);
 const outside=join(f.dir,'outside.mp3');writeFileSync(outside,'fixture');assert.throws(()=>s.start({file:outside}),/导入/);
 s.importAudio('my-song.mp3',Buffer.from('fixture'));assert.equal(s.state().sources.length,1);assert.equal(s.state().sources[0].file,undefined);
 assert.throws(()=>s.importAudio('../wrong.exe',Buffer.from('x')));assert.throws(()=>s.resultFile('../x','mixed'));
});
test('persisted completed variants remain separate; interrupted jobs do not restart',t=>{
 const f=fixture(t),id='fixture-done',dir=join(f.work,'breeze-cover/jobs',id);mkdirSync(dir,{recursive:true});
 const files={acappella:join(dir,'acappella.mp3'),mixed:join(dir,'mixed.mp3')};
 writeFileSync(files.acappella,'converted-vocal-only-fixture');writeFileSync(files.mixed,'vocal-and-instrumental-fixture');
 writeFileSync(join(f.root,'jobs.json'),JSON.stringify([{id,status:'done',files,arrangement:'acappella',createdAt:2},{id:'pending',status:'running',createdAt:1}]));
 const s=createStudio(f.opts);f.cleanup.push(()=>s.dispose());assert.deepEqual(s.status(id).job.variants,['acappella','mixed']);assert.equal(s.status('pending').job.status,'interrupted');assert.equal(s.idle(),true);
 assert.notEqual(readFileSync(s.resultFile(id,'acappella'),'utf8'),readFileSync(s.resultFile(id,'mixed'),'utf8'));assert.throws(()=>s.resultFile(id,'invalid'));
});
test('both controls retain two clear choices and never cross-write speech/reply settings',t=>{
 const f=fixture(t),s=createStudio(f.opts);f.cleanup.push(()=>s.dispose());let enabled=true;const routes=new Map();
 controls.setup({config:()=>f.cfg,use:id=>id==='breeze-cover'?(enabled?s:null):id==='voice'?{speak:async()=>{},breezeVoices:()=>[{id:'speech-keep',name:'讲话',description:''}]}:f.opts.getSong(),route:(p,fn)=>routes.set(p,fn),on:()=>{},setConfig:p=>merge(f.cfg,p),core:{http:{body:async x=>x}}});
 const select=routes.get('/select');
 return (async()=>{
  assert.equal((await select({kind:'breeze',voice:'sajiao_text_v2',arrangement:'acappella',keepMelody:2})).ok,true);
  assert.equal((await select({kind:'rvc',voice:'rvc-fixture',arrangement:'mixed'})).ok,true);
  assert.equal(f.cfg.ext.voice.breezeVoice,'speech-keep');assert.equal(f.cfg.ext['voice-controls'].replyMode,'voice');assert.equal(f.cfg.song.root,f.opts.getConfig().song.root);
  const before=JSON.stringify(f.cfg);assert.equal((await select({kind:'rvc',voice:'rvc-fixture',arrangement:'bad'})).ok,false);assert.equal(JSON.stringify(f.cfg),before);
  enabled=false;await select({kind:'rvc',voice:'rvc-fixture',arrangement:'acappella'});assert.equal(f.cfg.ext['breeze-cover'].rvcArrangement,'acappella');enabled=true;
  const data=routes.get('/state')(),flat=render(new URL('../assets/voice-controls/panel.js',import.meta.url),[data,data.speech.selected,data.rvc.selected,'','',data.reply.selected,data.breezeCover.selectedVoice,data.breezeCover.arrangement,data.rvc.arrangement,String(data.breezeCover.keepMelody)]);
  assert.equal(flat.filter(x=>x.type==='Select').length,7);assert.equal(flat.filter(x=>x.type==='Select'&&x.props.options?.some(o=>o.value==='acappella')).length,2);
  assert(flat.some(x=>x.type==='Btn'&&x.children.includes('保存Breeze翻唱设置')));
 })();
});
test('studio renders real per-variant players and a local-only start button for each engine',t=>{
 const f=fixture(t),s=createStudio(f.opts);f.cleanup.push(()=>s.dispose());const data=s.state();
 data.jobs=[{id:'fixture',engine:'breeze',voiceName:'女声',title:'测试',stage:'完成',status:'done',warnings:[],variants:['acappella','mixed']}];
 for(const engine of ['breeze','rvc']){
  const flat=render(new URL('../assets/breeze-cover/panel.js',import.meta.url),[data,engine,'sajiao_text_v2','rvc-fixture','acappella','2','','local','',[],'','0','10','','0','','']);
  const players=flat.filter(x=>x.type==='audio');assert.equal(players.length,2);assert(players.some(x=>x.props.src.includes('arrangement=acappella')));assert(players.some(x=>x.props.src.includes('arrangement=mixed')));
  assert(flat.some(x=>x.type==='Btn'&&x.children.includes('开始本机制作（不发QQ）')));
 }
});
test('owner tool permissions and explicit-version send guard without QQ',async t=>{
 const f=fixture(t),routes=new Map();let toolsBuilder,owner=false,sends=0,dispose;
 const id='fixture-done',dir=join(f.work,'breeze-cover/jobs',id);mkdirSync(dir,{recursive:true});
 const files={acappella:join(dir,'acappella.mp3'),mixed:join(dir,'mixed.mp3')};for(const p of Object.values(files))writeFileSync(p,'fixture');
 writeFileSync(join(f.root,'jobs.json'),JSON.stringify([{id,status:'done',files,createdAt:1}]));
 definition.setup({dir:new URL('../assets/breeze-cover/',import.meta.url).pathname,dataDir:()=>f.root,config:()=>f.cfg,settings:f.opts.getSettings,saveSettings:f.opts.saveSettings,use:id=>id==='voice'?f.opts.getBreeze():f.opts.getSong(),lib:id=>id==='core/store.js'?{dataDir:()=>f.work}:{songUrl:f.opts.resolveSongUrl},onDispose:fn=>{dispose=fn;},route:(p,fn)=>routes.set(p,fn),tool:fn=>{toolsBuilder=fn;},defineTool:x=>x,rule:()=>{},log:{},core:{hub:{turnHasOwner:()=>owner},http:{raw:async x=>Buffer.from(JSON.stringify(x)),query:x=>x,send:()=>{}}},sendVoiceFile:async()=>{sends++;}});f.cleanup.push(()=>dispose());
 assert.deepEqual(toolsBuilder({level:'full',chat:{kind:'group'}}),[]);assert.deepEqual(toolsBuilder({level:'limited',chat:{kind:'private'}}),[]);
 const tools=toolsBuilder({level:'full',chat:{kind:'private'},sessionId:'fixture'});assert.equal(tools.length,4);await assert.rejects(()=>tools[0].execute({}),/主人/);owner=true;assert.equal((await tools[0].execute({})).ok,true);
 await assert.rejects(()=>routes.get('/send')({id}),/明确选择/);assert.equal(sends,0);
});
test('WAV structural checks reject invalid/truncated data',t=>{
 const f=fixture(t),file=join(f.dir,'invalid.wav');writeFileSync(file,'not a song');assert.throws(()=>wavInfo(file),/有效WAV/);
 const b=Buffer.alloc(24);b.write('RIFF');b.write('WAVE',8);b.write('data',12);b.writeUInt32LE(100,16);writeFileSync(file,b);assert.throws(()=>wavInfo(file),/不完整/);
});
