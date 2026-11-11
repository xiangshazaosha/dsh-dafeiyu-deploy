import {pathToFileURL} from 'node:url';
const REVIEWED_PLUGIN=process.env.DSH_AURABOT_PLUGIN_DIR;
// All tests are isolated fixtures. No real music, QQ, network or inference.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,statSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createStudio} from '../assets/breeze-cover/studio.mjs';
import {createQQRouter,installNativeGuard,cleanQuery} from '../assets/breeze-cover/qq-router.mjs';
import {savedProfile,taskFromSavedProfile} from '../assets/breeze-cover/saved-profile.mjs';
import controls from '../assets/voice-controls/index.mjs';
import library from '../assets/song-library/index.mjs';
import {match} from '../assets/song-library/library.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const flush=()=>new Promise(r=>setImmediate(r));
function root(){return mkdtempSync(join(tmpdir(),'reuse-policy-'));}
function cleanup(path){assert(resolve(path).startsWith(resolve(tmpdir())+sep+'reuse-policy-'));rmSync(path,{recursive:true,force:true});}
function studioFixture(t){
 const base=root(),data=join(base,'data'),songWork=join(base,'songs'),rvc=join(base,'rvc'),voiceFile=join(base,'breeze-tts2','voices','female.breeze');
 for(const d of [join(data,'imports'),join(rvc,'bin'),join(rvc,'env','Scripts'),join(rvc,'separator-models'),join(base,'breeze-tts2','voices'),songWork,join(songWork,'breeze-cover','jobs','old-fixture')])mkdirSync(d,{recursive:true});
 // Invalid executables make an intentionally fresh fixture job fail safely at
 // probing. No model worker or external binary can run in these cache tests.
 for(const f of [join(rvc,'bin','ffmpeg.exe'),join(rvc,'env','Scripts','python.exe'),join(rvc,'separator-models','fixture.ckpt'),voiceFile])writeFileSync(f,'fixture-only');
 const filename='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa-test.m4a',file=join(data,'imports',filename);writeFileSync(file,'invalid-fixture-audio');
 const source={id:'i-'+sha(filename).slice(0,18),label:'test.m4a',file,origin:'本机导入'};
 const spec={engine:'breeze',voice:'female',arrangement:'acappella',startSec:0,durationSec:10,keepMelody:1,pitch:0,lyrics:'',source};
 const stamp=f=>statSync(f).size+':'+statSync(f).mtimeMs;
 const key=sha(JSON.stringify({...spec,arrangement:'both',sourceStamp:stamp(file),voiceStamp:stamp(voiceFile),version:2}));
 const files={acappella:join(songWork,'breeze-cover','jobs','old-fixture','acappella.mp3'),mixed:join(songWork,'breeze-cover','jobs','old-fixture','mixed.mp3')};for(const f of Object.values(files))writeFileSync(f,Buffer.alloc(2048,42));
 writeFileSync(join(data,'jobs.json'),JSON.stringify([{id:'old-fixture',key,...spec,status:'done',voiceName:'fixture',title:'test',files,seconds:10,createdAt:1,finishedAt:2}]));
 const settings={engine:'breeze',breezeVoice:'female',keepMelody:1,breezeArrangement:'acappella',reuseFinished:true};
 const studio=createStudio({root:data,songWork,workspace:base,worker:join(base,'must-not-run.py'),getConfig:()=>({song:{root:rvc,separatorModel:'fixture.ckpt',pitch:0}}),getSettings:()=>settings,saveSettings:p=>Object.assign(settings,p),getBreeze:()=>({breezeVoices:()=>[{id:'female',name:'fixture'},{id:'other',name:'other'}],breezeConvert:()=>assert.fail('inference forbidden')}),getSong:()=>({status:()=>({current:null,queue:[],voices:[]})}),resolveSongUrl:()=>assert.fail('network forbidden'),search:()=>assert.fail('network forbidden')});
 t.after(async()=>{studio.dispose();for(let i=0;i<100&&!studio.idle();i++)await new Promise(r=>setTimeout(r,10));assert(studio.idle());cleanup(base);});
 return {studio,settings,source,voiceFile,args:{sourceId:source.id,durationSec:10,startSec:0,engine:'breeze',voice:'female',arrangement:'acappella',keepMelody:1,pitch:0},files};
}
test('studio reuses only an exact fingerprint and creates no new job when enabled',t=>{
 const f=studioFixture(t),result=f.studio.start(f.args);assert(result.reused);assert.equal(result.job.id,'old-fixture');assert.equal(f.studio.state().jobs.length,1);assert.equal(f.studio.findFinished(f.args).job.id,'old-fixture');
});
test('disabled reuse really queues a new rendering and still deduplicates pending work',t=>{
 const f=studioFixture(t);f.studio.selectSettings({reuseFinished:false});assert.equal(f.studio.findFinished(f.args),null);
 const first=f.studio.start({...f.args,reuseFinished:true});assert.equal(first.reused,undefined);assert.notEqual(first.job.id,'old-fixture');
 const duplicate=f.studio.start(f.args);assert.equal(duplicate.job.id,first.job.id);assert.equal(f.studio.state().jobs.length,2);assert.equal(f.studio.state().reuseFinished,false);
});
test('an explicit per-song fresh request bypasses cache without changing the global setting',t=>{
 const f=studioFixture(t),result=f.studio.start({...f.args,reuseFinished:false});assert.notEqual(result.job.id,'old-fixture');assert.equal(f.settings.reuseFinished,true);
});
test('voice, model contents, lyrics, melody, clip changes and unsafe variants do not reuse stale audio',t=>{
 const f=studioFixture(t);for(const delta of [{voice:'other'},{lyrics:'new lyrics'},{keepMelody:2},{durationSec:15},{startSec:5}])assert.equal(f.studio.findFinished({...f.args,...delta}),null);
 writeFileSync(f.voiceFile,'changed-voice-model');assert.equal(f.studio.findFinished(f.args),null);
});
test('settings API rejects nonboolean reuse and profile revisions include the policy',t=>{
 const f=studioFixture(t),state=f.studio.state(),before=savedProfile(state);assert.throws(()=>f.studio.selectSettings({reuseFinished:'false'}));assert.equal(f.settings.reuseFinished,true);
 f.studio.selectSettings({reuseFinished:false});const next=f.studio.state();assert.notEqual(savedProfile(next).revision,before.revision);assert.throws(()=>taskFromSavedProfile(next,{profileRevision:before.revision,sourceId:f.source.id}),/设置已变化/);
 assert.equal(taskFromSavedProfile(next,{profileRevision:savedProfile(next).revision,sourceId:f.source.id}).reuseFinished,false);
});
function routerFixture(t,{engine='breeze',reuse=true,findFinished=null,old=[]}={}){
 const path=root();writeFileSync(join(path,'qq-requests.json'),JSON.stringify(old));const calls={starts:[],searches:[],voices:[]},jobs=new Map();
 const cfg={enabled:true,ownerQQ:'fixture',song:{enabled:true,voice:'rvc-one'},ext:{'breeze-cover':{reuseFinished:reuse}}};
 const state=()=>({engine,reuseFinished:reuse,ready:true,rvcReady:true,busy:false,selectedVoice:'female',rvcVoice:'rvc-one',rvcPitch:2,voices:[{id:'female',name:'女声'}],rvcVoices:[{id:'rvc-one',name:'RVC音色'}],breezeArrangement:'acappella',rvcArrangement:'acappella',keepMelody:1,qqDurationSec:60});
 const studio={state,findFinished:findFinished||(()=>null),search:async q=>{calls.searches.push(q);return {list:[{id:1,name:'夜曲',artists:'周杰伦'}]};},start:spec=>{calls.starts.push(spec);const job={...spec,id:'job-'+calls.starts.length,status:'queued',seconds:60};jobs.set(job.id,job);return {job};},status:id=>({job:jobs.get(id)}),resultFile:()=>'/fixture/acappella.mp3'};
 const router=createQQRouter({root:path,getConfig:()=>cfg,studio,sendText:async()=>{},sendVoice:async(...a)=>calls.voices.push(a)});t.after(()=>{router.dispose();cleanup(path);});return {router,calls,jobs,cfg,studio,path};
}
test('Breeze off and explicit fresh phrases reach rendering with reuseFinished:false',async t=>{
 for(const [reuse,text]of [[false,'周杰伦 夜曲'],[true,'重新翻唱周杰伦 夜曲']]){const f=routerFixture(t,{reuse});f.router.intercept({chatId:'private:fixture',song:text});await flush();assert.equal(f.calls.starts[0].reuseFinished,false);assert.equal(f.calls.starts[0].voice,'female');}
 assert.equal(cleanQuery('重新翻唱示例歌曲 示例原唱'),'示例歌曲 示例原唱');
});
test('RVC off bypasses native final cache and sends only an RVC-labelled current voice artifact',async t=>{
 const f=routerFixture(t,{engine:'rvc',reuse:false});const r=f.router.intercept({chatId:'private:fixture',song:'周杰伦 夜曲'});assert(r.handled);await flush();assert.equal(f.calls.starts[0].engine,'rvc');assert.equal(f.calls.starts[0].voice,'rvc-one');assert.equal(f.calls.starts[0].pitch,2);assert.equal(f.calls.starts[0].reuseFinished,false);
 f.jobs.get('job-1').status='done';await f.router.tick();await f.router.tick();assert.equal(f.calls.voices.length,1);assert.match(f.calls.voices[0][2],/成品·RVC·RVC音色/);assert(!f.calls.voices[0][2].includes('Breeze'));
});
test('an indexed exact NetEase artifact can be reused before any search',async t=>{
 const old=[{id:'old',status:'sent',query:'周杰伦 夜曲',jobId:'cached',createdAt:1,sourceSelection:{origin:'netease',songId:'1'},title:'夜曲 · 周杰伦'}];
 let previews=0;const f=routerFixture(t,{old,findFinished:a=>{previews++;return a.voice==='female'&&a.reuseFinished?{job:{id:'cached'}}:null;}});f.router.intercept({chatId:'private:fixture',song:'周杰伦 夜曲'});await flush();assert.equal(f.calls.searches.length,0);assert.equal(f.calls.starts[0].songId,'1');assert(previews>0);
});
test('RVC on can find an artifact freshly made by the unified pipeline, instead of reverting to an old native cache',async t=>{
 const old=[{id:'old',status:'sent',query:'周杰伦 夜曲',jobId:'cached',createdAt:1,sourceSelection:{origin:'netease',songId:'1'},title:'夜曲 · 周杰伦'}];
 const f=routerFixture(t,{engine:'rvc',old,findFinished:a=>a.engine==='rvc'&&a.voice==='rvc-one'?{job:{id:'cached'}}:null});assert(f.router.intercept({chatId:'private:fixture',song:'周杰伦 夜曲'}).handled);await flush();assert.equal(f.calls.searches.length,0);assert.equal(f.calls.starts[0].engine,'rvc');
});
test('legacy library only matches current RVC voice, pitch and engine, not a preferred wrong voice',t=>{
 const path=root();t.after(()=>cleanup(path));for(const f of ['a.mp3','b.mp3','c.mp3'])writeFileSync(join(path,f),Buffer.alloc(2048));
 writeFileSync(join(path,'歌曲库索引.json'),JSON.stringify({version:1,items:[{title:'夜曲',file:'a.mp3',voice:'old',pitch:0,preferred:true},{title:'夜曲',file:'b.mp3',voice:'new',pitch:2},{title:'夜曲',file:'c.mp3',voice:'new',pitch:2,engine:'breeze'}]}));
 assert.equal(match(path,'夜曲',{voice:'new',pitch:2,engine:'rvc'}).entry.file,'b.mp3');assert.equal(match(path,'夜曲',{voice:'other',pitch:2,engine:'rvc'}).kind,'none');
});
test('legacy library message and slash routes cannot play cached audio while reuse is off',async t=>{
 const path=root();t.after(()=>cleanup(path));const events=new Map(),commands=new Map(),cfg={workspaceDir:path,enabled:true,ownerQQ:'fixture',song:{enabled:true},ext:{'breeze-cover':{reuseFinished:false}}};let requests=0;
 const api={config:()=>cfg,isOwner:()=>true,on:(n,f)=>events.set(n,f),command:c=>commands.set(c.name,c),route:()=>{},use:id=>id==='song'?{request:()=>{requests++;return {message:'fresh queued'};}}:null,sendVoiceFile:()=>assert.fail('old cover forbidden'),sendText:()=>assert.fail('old text forbidden'),every:()=>{},onDispose:()=>{},context:()=>{},log:{warn:()=>{},info:()=>{}}};
 library.setup(api);const msg={kind:'private',userId:'fixture',chatId:'private:fixture',text:'唱夜曲',raw:{}};assert.equal(await events.get('message')(msg),false);assert.equal(await commands.get('sing').run('夜曲',msg),'fresh queued');assert.equal(requests,1);
});
test('policy button saves only one boolean, not an unsaved voice or unrelated configuration',async()=>{
 let reuse=true;const cfg={ext:{voice:{breezeVoice:'speech'}},song:{voice:'rvc-one'}},routes=new Map(),saved=[];
 const cover={state:()=>({engine:'breeze',reuseFinished:reuse,profile:{engine:'breeze',voice:'female',arrangement:'acappella',keepMelody:1,reuseFinished:reuse},qq:{guardInstalled:true},qqDurationSec:60,voices:[{id:'female',name:'女声'}],selectedVoice:'female',ready:true,breezeArrangement:'acappella',rvcArrangement:'mixed',keepMelody:1}),selectSettings:p=>{saved.push(p);reuse=p.reuseFinished;}};
 controls.setup({config:()=>cfg,use:id=>id==='breeze-cover'?cover:id==='voice'?{breezeVoices:()=>[{id:'speech',name:'讲话'}]}:{status:()=>({voices:[{id:'rvc-one'}]})},route:(p,f)=>routes.set(p,f),on:()=>{},core:{http:{body:async x=>x}}});const before=JSON.stringify(cfg),data=routes.get('/state')();
 const values=[data,'unsaved-speech','voice','breeze','unsaved-female','rvc-one','acappella','mixed','1','0','60','',''];const React={Fragment:'Fragment',useState:x=>[values.shift()??x,()=>{}],useEffect:()=>{}},h=(type,props,...children)=>({type,props,children}),ui=Object.fromEntries(['Card','Row','Btn','Select'].map(k=>[k,k]));
 let body;const Comp=new Function('React','h','ui','call',readFileSync(new URL('../assets/voice-controls/panel.js',import.meta.url),'utf8'))(React,h,ui,async(p,b)=>{body=b;return routes.get(p)(b);});const tree=Comp({toast:()=>{},reload:()=>{}}),nodes=[];function walk(n){if(n&&typeof n==='object'){nodes.push(n);(n.children||[]).flat(Infinity).forEach(walk);}}walk(tree);const button=nodes.find(n=>n.props?.role==='switch');assert(button);assert.equal(button.props['aria-checked'],true);await button.props.onClick();assert.deepEqual(body,{kind:'reuse',enabled:false});assert.deepEqual(saved,[{reuseFinished:false}]);assert.equal(JSON.stringify(cfg),before);assert.equal(routes.get('/state')().coverRouting.reuseFinished,false);assert.equal((await routes.get('/select')({kind:'reuse',enabled:'false'})).ok,false);
});
test('RVC-off slash entry with the real inner library guard reaches unified rendering, never native cache',async t=>{
 const f=routerFixture(t,{engine:'rvc',reuse:false}),handlers=new Map(),commands=new Map(),offs=[];
 const song={request:()=>assert.fail('native final cache must not execute')};
 const api={config:()=>f.cfg,isOwner:()=>true,use:id=>id==='song'?song:id==='breeze-cover'?{resolveEngine:f.router.resolveEngine}:null,on:(n,fn)=>handlers.set(n,fn),onDispose:fn=>offs.push(fn),every:()=>{},command:c=>commands.set(c.name,c),route:()=>{},context:()=>{},log:{warn:()=>{},info:()=>{}},sendVoiceFile:()=>assert.fail('old library must not send'),sendText:()=>assert.fail('old library must not send')};
 library.setup(api);installNativeGuard(api,f.router);t.after(()=>offs.reverse().forEach(fn=>fn()));
 const msg={kind:'private',userId:'fixture',chatId:'private:fixture',raw:{},text:'唱周杰伦夜曲'};assert.equal(await handlers.get('message')(msg),false);await commands.get('sing').run('周杰伦 夜曲',msg);await flush();assert.equal(f.calls.starts.length,1);assert.equal(f.calls.starts[0].engine,'rvc');assert.equal(f.calls.starts[0].reuseFinished,false);
});
test('installed real qq_song_cover RVC-off tool bypasses the native job cache and queue',{skip:!REVIEWED_PLUGIN},async t=>{
 const f=routerFixture(t,{engine:'rvc',reuse:false}),old=process.env.AURABOT_DATA_DIR;process.env.AURABOT_DATA_DIR=f.path;f.cfg.song.root=f.path;f.cfg.song.separatorModel='fixture.ckpt';let native,builder;const offs=[];
 try{const definition=(await import(pathToFileURL(join(REVIEWED_PLUGIN,'src/modules/song/index.js')).href)).default;
  const api={config:()=>f.cfg,core:{hub:{turnHasOwner:()=>true,sendVoiceFile:async()=>assert.fail('gateway forbidden'),sendText:async()=>assert.fail('gateway forbidden')},local:{active:()=>false},http:{}},lazy:()=>({}),log:{info:()=>{},warn:()=>{},debug:()=>{}},tool:fn=>builder=fn,route:()=>{},use:()=>native,on:()=>{},every:()=>{},onDispose:fn=>offs.push(fn)};
  native=definition.setup(api);installNativeGuard(api,f.router);const tool=builder({chat:{kind:'private',chatId:'private:fixture'},sessionId:'fixture'});const result=await tool.execute({song:'周杰伦 夜曲'});await flush();assert(result.ok);assert.equal(result.engine,'rvc');assert.equal(f.calls.starts[0].voice,'rvc-one');assert.equal(f.calls.starts[0].pitch,2);assert.equal(f.calls.starts[0].reuseFinished,false);assert.equal(native.status().current,null);assert.deepEqual(native.status().queue,[]);
 }finally{offs.reverse().forEach(fn=>fn());if(old===undefined)delete process.env.AURABOT_DATA_DIR;else process.env.AURABOT_DATA_DIR=old;}
});
