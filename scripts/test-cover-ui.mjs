import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {savedProfile,taskFromSavedProfile} from '../assets/breeze-cover/saved-profile.mjs';
import controls from '../assets/voice-controls/index.mjs';
const merge=(a,b)=>{for(const [k,v]of Object.entries(b))a[k]=v&&typeof v==='object'&&!Array.isArray(v)?merge(a[k]||{},v):v;return a;};
function state(){const s={ok:true,engine:'breeze',selectedVoice:'female',rvcVoice:'rvc-one',breezeArrangement:'acappella',rvcArrangement:'mixed',keepMelody:1,rvcPitch:0,ready:true,rvcReady:true,voices:[{id:'female',name:'女声'},{id:'female-two',name:'新女声'}],rvcVoices:[{id:'rvc-one',name:'RVC模型'}],qqDurationSec:60,sources:[{id:'source-one',label:'测试原曲'}],jobs:[],busy:false,qq:{guardInstalled:true,active:false,requests:[]}};return {...s,profile:savedProfile(s)};}
function render(path,values,call){
 const React={Fragment:'Fragment',useState:initial=>[values.length?values.shift():initial,()=>{}],useEffect:()=>{}},h=(type,props,...children)=>({type,props,children}),ui=Object.fromEntries(['Card','Btn','Row','Select'].map(k=>[k,k]));
 const Comp=new Function('React','h','ui','call',readFileSync(path,'utf8'))(React,h,ui,call),tree=Comp({toast:()=>{},reload:()=>{}}),flat=[];const walk=x=>{if(x&&typeof x==='object'){flat.push(x);(x.children||[]).flat(Infinity).forEach(walk);}};walk(tree);return flat;
}
function controlsFixture(){
 const cfg={enabled:true,dryRun:false,ext:{voice:{breezeVoice:'speech-keep'},'voice-controls':{replyMode:'voice'},'breeze-cover':{engine:'breeze',breezeVoice:'female',breezeArrangement:'acappella',rvcArrangement:'mixed',keepMelody:1,qqDurationSec:60}},song:{voice:'rvc-one',pitch:0,maxVoiceSec:60,root:'keep-root',neteaseCookie:'fixture-not-a-real-cookie'}};
 const cover={state:()=>{const x=state(),c=cfg.ext['breeze-cover'];Object.assign(x,{engine:c.engine,selectedVoice:c.breezeVoice,breezeArrangement:c.breezeArrangement,rvcArrangement:c.rvcArrangement,keepMelody:c.keepMelody,qqDurationSec:c.qqDurationSec,rvcVoice:cfg.song.voice,rvcPitch:cfg.song.pitch});x.profile=savedProfile(x);return x;},selectSettings:p=>{for(const[k,v]of Object.entries(p))if(v!==undefined)cfg.ext['breeze-cover'][k==='voice'?'breezeVoice':k]=v;}};
 const routes=new Map();controls.setup({config:()=>cfg,use:id=>id==='breeze-cover'?cover:id==='voice'?{speak:async()=>{},breezeVoices:()=>[{id:'speech-keep',name:'讲话',description:''}]}:{status:()=>({voices:state().rvcVoices})},route:(p,fn)=>routes.set(p,fn),on:()=>{},setConfig:p=>merge(cfg,p),core:{http:{body:async x=>x}}});return {cfg,cover,routes};
}
test('unified form atomically saves the chosen engine and keeps unrelated and inactive settings',async()=>{
 const f=controlsFixture(),select=f.routes.get('/select');
 assert.equal((await select({kind:'cover',engine:'breeze',voice:'female-two',arrangement:'mixed',keepMelody:2,qqDurationSec:30})).ok,true);
 assert.equal(f.cfg.ext['breeze-cover'].breezeVoice,'female-two');assert.equal(f.cfg.song.voice,'rvc-one');
 const b=JSON.stringify(f.cfg);assert.equal((await select({kind:'cover',engine:'breeze',voice:'rvc-one',arrangement:'mixed',keepMelody:2})).ok,false);assert.equal(JSON.stringify(f.cfg),b);
 assert.equal((await select({kind:'cover',engine:'rvc',voice:'rvc-one',arrangement:'acappella',pitch:2,qqDurationSec:15})).ok,true);
 assert.equal(f.cfg.song.pitch,2);assert.equal(f.cfg.song.maxVoiceSec,15);assert.equal(f.cfg.ext['breeze-cover'].engine,'rvc');assert.equal(f.cfg.ext['breeze-cover'].breezeVoice,'female-two');assert.equal(f.cfg.ext['breeze-cover'].keepMelody,2);
 assert.equal(f.cfg.ext.voice.breezeVoice,'speech-keep');assert.equal(f.cfg.ext['voice-controls'].replyMode,'voice');assert.equal(f.cfg.song.root,'keep-root');assert.equal(f.cfg.song.neteaseCookie,'fixture-not-a-real-cookie');
});
test('settings page has one cover form, one save and only active engine fields',async()=>{
 const f=controlsFixture(),data=f.routes.get('/state')(),calls=[];
 const flat=render(new URL('../assets/voice-controls/panel.js',import.meta.url),[data,'speech-keep','voice','breeze','female','rvc-one','acappella','mixed','1','0','60','',''],async(p,b)=>{calls.push({p,b});return {...data,message:'fixture'};});
 assert.equal(flat.filter(x=>x.type==='Row'&&x.props.label==='翻唱引擎').length,1);assert.equal(flat.filter(x=>x.type==='Row'&&x.props.label==='翻唱音色').length,1);assert.equal(flat.filter(x=>x.type==='Row'&&x.props.label==='输出版本').length,1);
 assert(!flat.some(x=>x.type==='Row'&&x.props.label==='RVC默认变调（半音）'));assert.equal(flat.filter(x=>x.type==='Btn'&&x.children.includes('保存统一翻唱设置')).length,1);
 await flat.find(x=>x.type==='Btn'&&x.children.includes('保存统一翻唱设置')).props.onClick();assert.equal(calls.length,1);assert.equal(calls[0].b.kind,'cover');assert.equal(calls[0].b.engine,'breeze');assert.equal(calls[0].b.voice,'female');
});
test('RVC draft shows pitch instead of Breeze melody controls, with no second voice form',async()=>{
 const f=controlsFixture();await f.routes.get('/select')({kind:'cover',engine:'rvc',voice:'rvc-one',arrangement:'mixed',pitch:3,qqDurationSec:30});const data=f.routes.get('/state')();
 const flat=render(new URL('../assets/voice-controls/panel.js',import.meta.url),[data,'speech-keep','voice','rvc','female','rvc-one','acappella','mixed','1','3','30','',''],async()=>{throw Error('No calls during render');});
 assert.equal(flat.filter(x=>x.type==='Row'&&x.props.label==='RVC默认变调（半音）').length,1);assert(!flat.some(x=>x.type==='Row'&&x.props.label==='保留旋律'));assert.equal(flat.filter(x=>x.type==='Row'&&x.props.label==='翻唱音色').length,1);assert.equal(data.coverRouting.profile.engine,'rvc');assert.equal(data.rvc.pitch,3);
});
test('workbench is read-only for sound and submits a revision, never duplicate audio settings',async()=>{
 const data=state(),calls=[];const flat=render(new URL('../assets/breeze-cover/panel.js',import.meta.url),[data,'source-one','local','',[],'','0','10','','',''],async(p,b)=>{calls.push({p,b});return p==='/state'?data:{...data,message:'fixture'};});
 assert(!flat.some(x=>x.type==='Row'&&['翻唱引擎','翻唱音色','输出版本','保留旋律','RVC变调（半音）'].includes(x.props.label)));
 assert.equal(flat.filter(x=>x.type==='Select').length,3);assert(!flat.some(x=>x.type==='Btn'&&x.children.some(c=>typeof c==='string'&&/保存.*(?:引擎|设置)/.test(c))));
 await flat.find(x=>x.type==='Btn'&&x.children.includes('按统一设置开始本机制作（不发QQ）')).props.onClick();
 const b=calls.find(x=>x.p==='/start').b;assert.equal(b.profileRevision,data.profile.revision);assert.equal(b.sourceId,'source-one');assert.equal(b.durationSec,10);for(const k of ['engine','voice','arrangement','keepMelody','pitch'])assert.equal(b[k],undefined);assert(!calls.some(x=>x.p==='/settings'));
 const actual=taskFromSavedProfile(data,b);assert.equal(actual.engine,'breeze');assert.equal(actual.voice,'female');assert.equal(actual.arrangement,'acappella');assert.equal(actual.keepMelody,1);
});
test('changed shared settings, legacy overrides and missing voices are blocked before making audio',()=>{
 const a=state(),body={profileRevision:a.profile.revision,sourceId:'source-one',durationSec:10};
 const changed={...a,selectedVoice:'female-two'};assert.throws(()=>taskFromSavedProfile(changed,body),/设置已变化/);
 assert.throws(()=>taskFromSavedProfile(a,{...body,engine:'rvc'}),/旧版制作页/);assert.throws(()=>taskFromSavedProfile(a,{sourceId:'source-one'}),/设置已变化/);
 assert.throws(()=>taskFromSavedProfile({...a,ready:false},body),/不会改用其他声音/);
 const missing={...a,selectedVoice:'deleted'};assert.equal(savedProfile(missing).ready,false);assert.throws(()=>taskFromSavedProfile(missing,{...body,profileRevision:savedProfile(missing).revision}),/未就绪/);
});
test('old per-task audio players and precise send binding are preserved',async()=>{
 const data=state();data.jobs=[{id:'old-rvc-job',engine:'rvc',voice:'rvc-one',voiceName:'RVC模型',title:'旧成品',status:'done',stage:'完成',warnings:[]}];let sent;const old=globalThis.window;globalThis.window={confirm:()=>true};
 try{const flat=render(new URL('../assets/breeze-cover/panel.js',import.meta.url),[data,'source-one','local','',[],'','0','10','','',''],async(p,b)=>{if(p==='/send')sent=b;return p==='/state'?data:{ok:true,message:'fixture'};});assert.equal(flat.filter(x=>x.type==='audio').length,2);await flat.find(x=>x.type==='Btn'&&x.children.includes('发送此版本到主人QQ')).props.onClick();assert.equal(sent.expectedEngine,'rvc');assert.equal(sent.expectedVoice,'rvc-one');assert.equal(sent.arrangement,'acappella');}finally{if(old===undefined)delete globalThis.window;else globalThis.window=old;}
});
