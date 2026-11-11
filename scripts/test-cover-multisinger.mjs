// Generic reproduction: no user directory, imported recording or real QQ data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {createLocalSources,matchLocalSources} from '../assets/breeze-cover/local-sources.mjs';
import {createQQRouter} from '../assets/breeze-cover/qq-router.mjs';
import definition from '../assets/breeze-cover/index.mjs';
const source={id:'i-bbbbbbbbbbbbbbbbbb',label:'测试合唱曲.m4a',origin:'本机导入'};
const meta={[source.id]:{title:'测试合唱曲',artists:'本地片段演唱者',songArtists:['歌手甲','歌手乙'],aliases:[]}};
const query='测试合唱曲 歌手甲 歌手乙',flush=()=>new Promise(r=>setImmediate(r));
function cleanup(root){assert(resolve(root).startsWith(resolve(tmpdir())+sep+'multisinger-'));rmSync(root,{recursive:true,force:true});}
function fixture(t,{available=true,seed=[],canUseSong}={}){
 const root=mkdtempSync(join(tmpdir(),'multisinger-'));let sources=available?[source]:[];writeFileSync(join(root,'local-sources.json'),JSON.stringify({version:1,entries:meta}));writeFileSync(join(root,'qq-requests.json'),JSON.stringify(seed));
 const calls={starts:[],searches:[],texts:[]},cfg={enabled:true,ownerQQ:'fixture',song:{enabled:true}};
 const state=()=>({engine:'rvc',reuseFinished:false,rvcReady:true,ready:true,busy:false,rvcVoice:'fixture-rvc',rvcVoices:[{id:'fixture-rvc'}],rvcArrangement:'mixed',rvcPitch:0,qqDurationSec:60});
 const studio={state,search:async q=>{calls.searches.push(q);return {list:[{id:'1',name:'测试合唱曲 (Live)',artists:'歌手甲 / 歌手丙'},{id:'2',name:'测试合唱曲 (Live)',artists:'歌手甲'},{id:'3',name:'测试合唱曲 (Live伴奏)',artists:'歌手甲'},{id:'4',name:'测试合唱曲',artists:'另一位演唱者'}]};},start:spec=>{calls.starts.push(spec);return {job:{id:'fixture-job'}};}};
 const localSources=createLocalSources({root,getSources:()=>sources}),router=createQQRouter({root,getConfig:()=>cfg,studio,localSources,canUseSong,sendText:async(...a)=>calls.texts.push(a),sendVoice:async()=>assert.fail('No QQ send')});
 t.after(()=>{router.dispose();cleanup(root);});return {root,cfg,calls,router,localSources,add:()=>{sources=[source];}};
}
test('multiple known work artists match in either order and with common connectors',()=>{
 for(const q of [query,'歌手乙 歌手甲 测试合唱曲','歌手甲和歌手乙的测试合唱曲','测试合唱曲 歌手甲/歌手乙','歌手甲测试合唱曲歌手乙','测试合唱曲 歌手甲','测试合唱曲'])assert.equal(matchLocalSources(q,[source],meta).length,1,q);
 for(const q of ['测试合唱曲 歌手丙版','测试合唱曲 歌手甲 Live','测试合唱曲 新版本'])assert.equal(matchLocalSources(q,[source],meta).length,0,q);
});
test('RVC fresh mode still uses local original; disabling finished reuse does not disable local input',async t=>{
 const f=fixture(t);const result=f.router.intercept({chatId:'private:fixture',song:query});assert(result.result.ok);await flush();assert.equal(f.calls.starts.length,1);assert.equal(f.calls.starts[0].sourceId,source.id);assert.equal(f.calls.starts[0].reuseFinished,false);assert.equal(f.calls.starts[0].voice,'fixture-rvc');assert.equal(f.calls.searches.length,0);assert.equal(f.calls.texts.length,0);
});
test('explicit original artists are required: no unrelated singer or accompaniment quiz',async t=>{
 const f=fixture(t,{available:false}),strict=query+' 原唱版';f.router.intercept({chatId:'private:fixture',song:strict});await flush();const r=f.router.status().requests[0];assert.equal(r.status,'source_unavailable');assert.deepEqual(r.candidates,[]);assert.equal(r.searchEvidence.matched,0);assert.equal(f.calls.starts.length,0);assert(!f.calls.texts[0][1].includes('/coverpick'));
 const duplicate=f.router.intercept({chatId:'private:fixture',song:strict});assert.equal(duplicate.result.reused,true);assert.equal(duplicate.result.ok,false);assert.equal(f.calls.searches.length,1);
});
test('adding a local source makes a prior failed online lookup obsolete immediately',async t=>{
 const f=fixture(t,{available:false,canUseSong:async()=>false});const first=f.router.intercept({chatId:'private:fixture',song:query});await flush();f.add();const next=f.router.intercept({chatId:'private:fixture',song:query});await flush();assert.notEqual(next.result.requestId,first.result.requestId);assert.equal(f.calls.starts.length,1);assert.equal(f.calls.starts[0].sourceId,source.id);assert.equal(f.calls.searches.length,1);assert.equal(f.router.status().requests.find(r=>r.id===first.result.requestId).status,'superseded');
});
test('continuing the original superseded RVC request preserves the single request and selected voice',async t=>{
 const spec={engine:'rvc',voice:'fixture-rvc',arrangement:'mixed',pitch:0,reuseFinished:false,startSec:0,durationSec:60,keepMelody:0,lyrics:''};
 const seed=[{id:'old-fixture',status:'superseded',engine:'rvc',voice:'fixture-rvc',arrangement:'mixed',voiceName:'fixture-rvc',spec,query,sourcePreference:'auto',ownerStamp:createHash('sha256').update('fixture').digest('hex'),createdAt:1}];
 const f=fixture(t,{seed});assert(f.router.resume(seed[0].id).ok);await flush();assert.equal(f.router.status().requests.length,1);assert.equal(f.calls.starts[0].sourceId,source.id);assert.equal(f.calls.starts[0].reuseFinished,false);assert.equal(f.calls.searches.length,0);assert.throws(()=>f.router.resume(seed[0].id),/未重复制作/);
});
test('search adapter asks for 30 results rather than being limited to the native short list',async t=>{
 const root=mkdtempSync(join(tmpdir(),'multisinger-')),routes=new Map(),offs=[],seen=[];let settings={engine:'rvc'};const song={request:()=>assert.fail('No native job'),status:()=>({voices:[]})};
 const api={dir:root,dataDir:()=>root,config:()=>({song:{neteaseCookie:'fixture-not-real'},ownerQQ:'fixture'}),settings:()=>settings,saveSettings:p=>Object.assign(settings,p),lib:id=>id==='core/store.js'?{dataDir:()=>join(root,'songs')}:{searchSongs:async(q,opts)=>{seen.push({q,limit:opts.limit});return [];}},use:id=>id==='song'?song:null,on:()=>{},every:()=>{},onDispose:f=>offs.push(f),route:(p,f)=>routes.set(p,f),command:()=>{},tool:()=>{},rule:()=>{},log:{},core:{http:{query:q=>q}},sendText:()=>assert.fail('No send'),sendVoiceFile:()=>assert.fail('No send')};
 t.after(()=>{offs.reverse().forEach(f=>f());cleanup(root);});definition.setup(api);const r=await routes.get('/search')({q:'测试合唱曲'});assert(r.ok);assert.deepEqual(seen,[{q:'测试合唱曲',limit:30}]);
});
