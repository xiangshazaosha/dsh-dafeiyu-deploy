import {pathToFileURL} from 'node:url';
const REVIEWED_PLUGIN=process.env.DSH_AURABOT_PLUGIN_DIR;
// Reproduction of request example-request using fixtures: no real QQ or generation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {matchLocalSources,createLocalSources} from '../assets/breeze-cover/local-sources.mjs';
import {chooseCandidate,createQQRouter,SOURCE_SELECTION_REVISION,installNativeGuard} from '../assets/breeze-cover/qq-router.mjs';
const source={id:'i-aaaaaaaaaaaaaaaaaa',label:'示例歌曲_MV_上传者.m4a',origin:'本机导入'};
const meta={[source.id]:{title:'示例歌曲',artists:'',songArtists:['示例歌手甲'],aliases:['示例歌曲_MV']}};
const candidates=[{id:'316100',name:'示例歌曲',artists:'示例歌手甲',alias:'电视剧《海派甜心》片尾曲',durationSec:260},{id:'25713097',name:'示例歌曲(Live)',artists:'示例歌手甲',durationSec:139},{id:'1882809264',name:'示例歌曲',artists:'示例歌手乙 / 示例歌手甲',durationSec:23},{id:'316114',name:'新流感',artists:'示例歌手甲',durationSec:207},{id:'2016364526',name:'示例歌曲（Cover：示例歌手甲）',artists:'瑜桉',durationSec:264}];
const flush=()=>new Promise(r=>setImmediate(r));
const hash=x=>createHash('sha256').update(String(x)).digest('hex');
function cleanup(root){assert(resolve(root).startsWith(resolve(tmpdir())+sep+'reported-local-'));rmSync(root,{recursive:true,force:true});}
function fixture(t,{seed=[]}={}){
 const root=mkdtempSync(join(tmpdir(),'reported-local-'));writeFileSync(join(root,'local-sources.json'),JSON.stringify({version:1,entries:meta}));writeFileSync(join(root,'qq-requests.json'),JSON.stringify(seed));
 const calls={starts:[],searches:[],texts:[]},cfg={enabled:true,ownerQQ:'fixture',song:{enabled:true,root,separatorModel:'fixture.ckpt'}};
 const state=()=>({engine:'breeze',ready:true,busy:false,selectedVoice:'taiwan_text_v2',voices:[{id:'taiwan_text_v2',name:'示例女声'}],qqDurationSec:60,breezeArrangement:'acappella',keepMelody:2});
 const studio={state,search:async q=>{calls.searches.push(q);return {list:candidates};},start:a=>{calls.starts.push(a);return {job:{id:'local-fixture-job'}};}};
 const localSources=createLocalSources({root,getSources:()=>[source]});
 const router=createQQRouter({root,getConfig:()=>cfg,studio,localSources,sendText:async(...a)=>calls.texts.push(a),sendVoice:async()=>assert.fail('No real send')});
 t.after(async()=>{for(let i=0;;i++){try{router.dispose();break;}catch(e){if(i>=4||!['EPERM','EBUSY'].includes(e.code))throw e;await new Promise(r=>setTimeout(r,50*(i+1)));}}cleanup(root);});return {root,cfg,studio,localSources,router,calls};
}
test('title + original-work artist matches local file without mislabelling its performer',()=>{
 for(const q of ['示例歌曲','示例歌曲 示例歌手甲','示例歌手甲 示例歌曲','示例歌手甲的示例歌曲','示例歌曲-示例歌手甲','《示例歌曲》 示例歌手甲']){
  const match=matchLocalSources(q,[source],meta);assert.equal(match.length,1,q);assert.equal(match[0].sourceId,source.id);assert.match(match[0].artists,/本机导入.*原曲歌手/);
 }
 assert.equal(matchLocalSources('王菲 示例歌曲',[source],meta).length,1);assert.equal(matchLocalSources('王菲版 示例歌曲',[source],meta).length,0);
 assert.equal(matchLocalSources('示例歌曲 Live',[source],meta).length,0);
});
test('work-artist metadata persists across reload and bad metadata cannot overwrite it',t=>{
 const f=fixture(t);f.localSources.set({sourceId:source.id,...meta[source.id]});
 assert.equal(createLocalSources({root:f.root,getSources:()=>[source]}).match('示例歌曲 示例歌手甲').length,1);
 const before=readFileSync(join(f.root,'local-sources.json'),'utf8');assert.throws(()=>f.localSources.set({sourceId:source.id,title:'示例歌曲',songArtists:[{}]}));assert.equal(readFileSync(join(f.root,'local-sources.json'),'utf8'),before);assert.equal(f.localSources.list()[0].artists,'');
});
test('exact reported QQ query resolves locally, never searches, prompts, or chooses RVC',async t=>{
 const f=fixture(t),r=f.router.intercept({chatId:'private:fixture',song:'示例歌曲 示例歌手甲'});await flush();assert(r.result.ok);assert.equal(f.calls.starts.length,1);assert.equal(f.calls.starts[0].sourceId,source.id);assert.equal(f.calls.starts[0].songId,undefined);assert.equal(f.calls.starts[0].voice,'taiwan_text_v2');assert.equal(f.calls.starts[0].keepMelody,2);assert.equal(f.calls.starts[0].arrangement,'acappella');assert.equal(f.calls.searches.length,0);assert.equal(f.calls.texts.length,0);assert.equal(f.router.status().requests[0].sourceSelection.origin,'local');
});
test('NetEase fallback ranks solo studio over a 23-second collaboration, regardless of order',()=>{
 for(const list of [candidates,[candidates[2],...candidates.filter(x=>x!==candidates[2])]]){
  for(const q of ['示例歌曲 示例歌手甲','示例歌手甲的示例歌曲','示例歌曲'])assert.equal(chooseCandidate(q,list)?.id,'316100',q);
 }
 assert.equal(chooseCandidate('示例歌曲 示例歌手甲 Live',candidates)?.id,'25713097');
 assert.equal(chooseCandidate('示例歌曲 示例歌手乙 示例歌手甲',candidates)?.id,'1882809264','explicit duet remains valid');
});
test('old waiting list is superseded, and cannot be reused or selected after fixing the source matcher',async t=>{
 const spec={engine:'breeze',voice:'taiwan_text_v2',arrangement:'acappella',startSec:0,durationSec:60,keepMelody:2,lyrics:''};
 const key=hash(JSON.stringify({query:'示例歌曲 示例歌手甲',sourcePreference:'auto',songId:undefined,file:undefined,...spec}));
 const old={id:'example-request-fixture',key,ownerStamp:hash('fixture'),status:'needs_choice',query:'示例歌曲 示例歌手甲',engine:'breeze',voice:'taiwan_text_v2',arrangement:'acappella',createdAt:1,spec,candidates};
 const f=fixture(t,{seed:[old]});assert.equal(f.router.status().requests[0].status,'superseded');assert.throws(()=>f.router.choose(old.id,1),/不在等待选歌/);assert.equal(f.calls.starts.length,0);assert.equal(f.calls.texts.length,0);
 const next=f.router.intercept({chatId:'private:fixture',song:'示例歌曲 示例歌手甲'});await flush();assert.notEqual(next.result.requestId,old.id);assert.equal(next.result.reused,undefined);assert.equal(f.calls.starts[0].sourceId,source.id);assert.equal(f.calls.searches.length,0);
 assert.equal(f.router.status().requests.find(r=>r.id===next.result.requestId).selectionRevision,SOURCE_SELECTION_REVISION);
});
test('the installed qq_song_cover tool processes exact reported words via local selection',{skip:!REVIEWED_PLUGIN},async t=>{
 const f=fixture(t),previous=process.env.AURABOT_DATA_DIR;process.env.AURABOT_DATA_DIR=f.root;let native,builder;const offs=[];
 try{
  const definition=(await import(pathToFileURL(join(REVIEWED_PLUGIN,'src/modules/song/index.js')).href)).default;
  const api={config:()=>f.cfg,core:{hub:{turnHasOwner:()=>true,sendVoiceFile:async()=>assert.fail('Gateway forbidden'),sendText:async()=>assert.fail('Gateway forbidden')},local:{active:()=>false},http:{}},lazy:()=>({}),log:{info:()=>{},warn:()=>{},debug:()=>{}},tool:fn=>builder=fn,route:()=>{},use:()=>native,on:()=>{},every:()=>{},onDispose:fn=>offs.push(fn)};
  native=definition.setup(api);installNativeGuard(api,f.router);const tool=builder({chat:{kind:'private',chatId:'private:fixture'},sessionId:'fixture'});
  assert.equal(tool.name,'qq_song_cover');const result=await tool.execute({song:'示例歌曲 示例歌手甲',pitch:0});await flush();assert(result.ok);assert.equal(f.calls.starts[0].sourceId,source.id);assert.equal(f.calls.searches.length,0);assert.equal(native.status().current,null);assert.deepEqual(native.status().queue,[]);
 }finally{for(const off of offs.reverse())off();if(previous===undefined)delete process.env.AURABOT_DATA_DIR;else process.env.AURABOT_DATA_DIR=previous;}
});
test('explicit resume continues only a never-started superseded request locally once, with original parameters',async t=>{
 const spec={engine:'breeze',voice:'taiwan_text_v2',arrangement:'acappella',keepMelody:2,startSec:0,durationSec:60,lyrics:''};
 const seed={id:'superseded-fixture',ownerStamp:hash('fixture'),status:'superseded',engine:'breeze',voice:'taiwan_text_v2',voiceName:'台湾腔甜妹',arrangement:'acappella',spec,query:'示例歌曲 示例歌手甲',sourcePreference:'auto',createdAt:1};
 const f=fixture(t,{seed:[seed]});assert(f.router.resume(seed.id).ok);await flush();assert.equal(f.calls.starts.length,1);assert.equal(f.calls.starts[0].sourceId,source.id);assert.equal(f.calls.starts[0].durationSec,60);assert.equal(f.calls.searches.length,0);assert.equal(f.calls.texts.length,0);assert.equal(f.router.status().requests[0].id,seed.id);assert.throws(()=>f.router.resume(seed.id),/未重复/);assert.equal(f.calls.starts.length,1);
});
test('resume cannot resend sent or uncertain artifacts, bypass owner checks or use changed settings',t=>{
 const spec={engine:'breeze',voice:'taiwan_text_v2',arrangement:'acappella',keepMelody:2,durationSec:60};
 for(const status of ['sent','delivery_uncertain','running','failed']){
  const f=fixture(t,{seed:[{id:'blocked-'+status,status,engine:'breeze',voice:'taiwan_text_v2',arrangement:'acappella',spec,query:'示例歌曲 示例歌手甲',ownerStamp:hash('fixture'),createdAt:1}]});assert.throws(()=>f.router.resume('blocked-'+status));assert.equal(f.calls.starts.length,0);
 }
 const wrongOwner=fixture(t,{seed:[{id:'wrong-owner',status:'superseded',ownerStamp:hash('someone-else'),createdAt:1}]});assert.throws(()=>wrongOwner.router.resume('wrong-owner'),/主人身份/);
 const changed=fixture(t,{seed:[{id:'changed',status:'superseded',engine:'breeze',voice:'other',arrangement:'acappella',spec,ownerStamp:hash('fixture'),createdAt:1}]});assert.throws(()=>changed.router.resume('changed'),/设置不一致/);
});
