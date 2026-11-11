// Isolated fixtures only: no inference, media downloads or real QQ calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {createQQRouter,cleanQuery,sourcePreference} from '../assets/breeze-cover/qq-router.mjs';
import {createLocalSources,matchLocalSources} from '../assets/breeze-cover/local-sources.mjs';
const local={id:'i-aaaaaaaaaaaaaaaaaa',label:'示例歌曲_MV_上传者.m4a',origin:'本机导入'};
const second={id:'i-111111111111111111',label:'示例歌曲 Live.wav',origin:'本机导入'};
const metadata={[local.id]:{title:'示例歌曲',artists:'',aliases:['示例歌曲_MV']}};
const flush=()=>new Promise(r=>setImmediate(r));
function cleanup(root){assert(resolve(root).startsWith(resolve(tmpdir())+sep+'local-first-'));rmSync(root,{recursive:true,force:true});}
function temp(t){const root=mkdtempSync(join(tmpdir(),'local-first-'));t.after(()=>cleanup(root));return root;}
function fixture(t,{sources=[local],meta=metadata,badRegistry=false}={}){
 const root=mkdtempSync(join(tmpdir(),'local-first-'));writeFileSync(join(root,'local-sources.json'),badRegistry?'bad json':JSON.stringify({version:1,entries:meta}));
 const registry=createLocalSources({root,getSources:()=>sources}),calls={start:[],search:[],text:[],voice:[]},jobs=new Map();
 const cfg={enabled:true,song:{enabled:true},ownerQQ:'fixture'};
 const studio={state:()=>({engine:'breeze',ready:true,busy:false,selectedVoice:'female',voices:[{id:'female',name:'女声'}],breezeArrangement:'acappella',keepMelody:1,qqDurationSec:60}),search:async q=>{calls.search.push(q);return {list:[{id:123,name:q,artists:'原曲歌手'}]};},start:spec=>{calls.start.push(spec);const id='job-'+calls.start.length;jobs.set(id,{...spec,id,status:'queued',seconds:60});return {job:{id}};},status:id=>({job:jobs.get(id)}),resultFile:()=>'/fixture/clear.mp3'};
 const router=createQQRouter({root,getConfig:()=>cfg,studio,localSources:registry,sendText:async(...a)=>calls.text.push(a),sendVoice:async(...a)=>calls.voice.push(a)});t.after(()=>{router.dispose();cleanup(root);});
 return {registry,calls,router,jobs,root,request:song=>router.intercept({song,chatId:'private:fixture'})};
}
test('registered 示例歌曲 resolves the actual long filename, without prefix or substring guessing',()=>{
 assert.equal(matchLocalSources('示例歌曲',[local],metadata)[0].sourceId,local.id);
 assert.equal(matchLocalSources('示例歌曲_MV',[local],metadata).length,1);
 assert.equal(matchLocalSources('雨',[local],metadata).length,0);
 assert.equal(matchLocalSources('听海',[{...local,label:'海.m4a'}]).length,0);
 assert.equal(matchLocalSources('示例原唱示例歌曲',[local],metadata).length,0,'unverified artist is not guessed');
});
test('generic imports match exact filename stems, but anonymous caches never auto-match',()=>{
 assert.equal(matchLocalSources('夜曲',[{...local,label:'夜曲.mp3'}]).length,1);
 assert.equal(matchLocalSources('夜曲',[{id:'c-123',label:'夜曲.mp3',origin:'已有缓存'}]).length,0);
 assert.equal(matchLocalSources('周杰伦的夜曲',[{...local,label:'夜曲.mp3'}],{[local.id]:{title:'夜曲',artists:'周杰伦'}}).length,1);
});
test('catalog persists aliases, is dynamic, rejects nonexistent IDs and validates without overwriting',t=>{
 const root=temp(t);let sources=[local];const registry=createLocalSources({root,getSources:()=>sources});
 registry.set({sourceId:local.id,title:'示例歌曲',aliases:['示例歌曲_MV']});
 assert.equal(createLocalSources({root,getSources:()=>sources}).match('示例歌曲').length,1);
 const before=readFileSync(join(root,'local-sources.json'),'utf8');
 assert.throws(()=>registry.set({sourceId:'i-000000000000000000',title:'wrong'}));
 assert.throws(()=>registry.set({sourceId:local.id,title:'',aliases:[]}));
 assert.throws(()=>registry.set({sourceId:local.id,title:'ok',aliases:['']}));
 assert.equal(readFileSync(join(root,'local-sources.json'),'utf8'),before);sources=[];assert.equal(registry.match('示例歌曲').length,0);
});
test('QQ local hit starts one selected Breeze sourceId, never searches or downloads from NetEase',async t=>{
 const f=fixture(t);assert(f.request('唱示例歌曲 清唱').result.ok);await flush();
 assert.equal(f.calls.start.length,1);assert.equal(f.calls.start[0].sourceId,local.id);assert.equal(f.calls.start[0].songId,undefined);assert.equal(f.calls.start[0].engine,'breeze');assert.equal(f.calls.start[0].voice,'female');assert.equal(f.calls.start[0].arrangement,'acappella');
 assert.equal(f.calls.search.length,0);assert.equal(f.calls.text.length,0);assert.equal(f.calls.voice.length,0);assert.equal(f.router.status().requests[0].sourceSelection.origin,'local');
 assert(f.request('唱示例歌曲 清唱').result.reused);assert.equal(f.calls.start.length,1);
});
test('no local match automatically falls through to original NetEase selection',async t=>{
 const f=fixture(t);f.request('夜曲');await flush();assert.deepEqual(f.calls.search,['夜曲']);assert.equal(f.calls.start[0].songId,'123');assert.equal(f.calls.start[0].sourceId,undefined);assert.equal(f.router.status().requests[0].sourceSelection.origin,'netease');
});
test('explicit NetEase skips a matching local source; explicit missing local never searches',async t=>{
 const f=fixture(t);f.request('用网易云唱示例歌曲');await flush();assert.deepEqual(f.calls.search,['示例歌曲']);assert.equal(f.calls.start[0].songId,'123');
 const g=fixture(t);g.request('用本地唱夜曲');await flush();assert.equal(g.calls.search.length,0);assert.equal(g.calls.start.length,0);assert.equal(g.router.status().requests[0].status,'failed');
});
test('explicit Live never accidentally uses a studio alias',async t=>{
 const f=fixture(t);f.request('示例歌曲 Live');await flush();assert.equal(f.calls.search[0],'示例歌曲 Live');assert.equal(f.calls.start[0].sourceId,undefined);
});
test('multiple local copies require choice, never search online; choice continues same request once',async t=>{
 const f=fixture(t,{sources:[local,second],meta:{...metadata,[second.id]:{title:'示例歌曲'}}});const r=f.request('示例歌曲');await flush();
 assert.equal(f.calls.start.length,0);assert.equal(f.calls.search.length,0);assert.equal(f.router.status().requests[0].status,'needs_choice');
 assert(f.router.choose(r.result.requestId,2).ok);assert.equal(f.calls.start[0].sourceId,second.id);assert.equal(f.calls.start[0].songId,undefined);assert.throws(()=>f.router.choose(r.result.requestId,1));
});
test('corrupt local index fails the request without dropping the router or falling back online',async t=>{
 const f=fixture(t,{badRegistry:true});assert(f.request('示例歌曲').result.ok);await flush();assert.equal(f.calls.start.length,0);assert.equal(f.calls.search.length,0);assert.equal(f.router.status().requests[0].status,'failed');assert.match(f.router.status().requests[0].message,/索引无效/);
});
test('local job completion uses the same exact voice/variant one-send checks',async t=>{
 const f=fixture(t);f.request('示例歌曲');await flush();f.jobs.get('job-1').status='done';await f.router.tick();await f.router.tick();assert.equal(f.calls.voice.length,1);assert.match(f.calls.voice[0][2],/Breeze CPP.*女声.*清唱/);assert.equal(f.router.status().requests[0].status,'sent');
});
test('source instructions are removed from the song name, and conflicting instructions are rejected',()=>{
 assert.equal(cleanQuery('用本地唱示例歌曲 清唱'),'示例歌曲');assert.equal(cleanQuery('从网易云唱孙燕姿的遇见'),'孙燕姿的遇见');assert.equal(sourcePreference('示例歌曲'),'auto');assert.equal(sourcePreference('网易云示例歌曲'),'netease');assert.equal(sourcePreference('本地示例歌曲'),'local');assert.throws(()=>sourcePreference('本地网易云示例歌曲'));
});
