// Synthetic search results only: no credentials, private media or live QQ sends.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {chooseOnlineSource,rankAlternativeSources,createQQRouter} from '../assets/breeze-cover/qq-router.mjs';
const title='测试告白曲',query=title+' 原作者甲';
const item=(id,name=title,artists='演唱者乙',more={})=>({id:String(id),name,artists,durationSec:215,...more});
const results=[item(1,title+' (钢琴版) [原唱: 原作者甲]'),item(2,title+' Type Beat'),item(3,'别的歌'),item(4,title+' (Live)'),item(5),item(6,title+' (伴奏)'),item(7,title+' Remix')];
test('artist hints do not block ordinary alternate vocals when the original is absent',async()=>{
 const probes=[],r=await chooseOnlineSource(query,results,async id=>(probes.push(id),true));
 assert.equal(r.choice.item.id,'5');assert(r.alternate);assert.match(r.choice.reason,/不是原唱本人/);assert.deepEqual(probes,['5']);
});
test('an available original has priority regardless of platform result order',async()=>{
 const r=await chooseOnlineSource(query,[...results,item(8,title,'原作者甲')],async()=>true);assert.equal(r.choice.item.id,'8');assert.equal(r.alternate,false);
});
test('unavailable originals and unavailable/trial alternatives are skipped, without repeated probes',async()=>{
 const probes=[],r=await chooseOnlineSource(query,[...results,item(8,title,'原作者甲'),item(9,title,'演唱者丙')],async id=>(probes.push(id),id==='9'));
 assert.equal(r.choice.item.id,'9');assert(r.alternate);assert.deepEqual(probes,['8','5','9']);
});
test('probes are bounded and no available full audio gives a terminal unavailable result',async()=>{
 const list=Array.from({length:20},(_,n)=>item(n+1)),probes=[];
 const r=await chooseOnlineSource(query,list,async id=>(probes.push(id),false));assert.equal(r.choice,null);assert(r.unavailable);assert.equal(r.probes,6);assert.equal(new Set(probes).size,6);
});
test('actual lookup failures are not disguised as missing copyright or bad title',async()=>{
 await assert.rejects(()=>chooseOnlineSource(query,results,async()=>{throw Error('fixture network error');}),/fixture network error/);
});
test('explicit original, named versions and no-other-singer requirements are not relaxed',async()=>{
 for(const q of [query+' 原唱版',query+' 本人版',title+' 原作者甲版',query+' 必须原唱',query+' 不要其他歌手',query+' 指定版本']){
  const r=await chooseOnlineSource(q,[item(5)],async()=>true);assert.equal(r.choice,null,q);assert(r.unavailable,q);
 }
 assert.equal((await chooseOnlineSource(query+' 原唱版',[item(8,title,'原作者甲')],async()=>true)).choice.item.id,'8');
});
test('instrumental and production beats cannot become a voice-conversion source',async()=>{
 const list=['纯音乐','伴奏','Instrumental','钢琴版','Piano','typebeat','Type Beat'].map((tag,n)=>item(n+1,title+' ('+tag+')'));
 assert.equal(rankAlternativeSources(query,list).length,0);assert.equal((await chooseOnlineSource(query,list,async()=>true)).choice,null);
});
test('full title boundaries reject unrelated substring titles and wrong requested versions',async()=>{
 assert.equal(rankAlternativeSources('更长的'+title+' 原作者甲',[item(5)]).length,0);
 assert.equal(rankAlternativeSources(title+'上篇 原作者甲',[item(5)]).length,0);
 for(const q of [query+' Live',query+' DJ版'])assert.equal((await chooseOnlineSource(q,[item(5)],async()=>true)).choice,null);
 const r=await chooseOnlineSource(query+' 不要Live',[item(4,title+' Live'),item(5)],async()=>true);assert.equal(r.choice.item.id,'5');
});
test('ordinary title-only requests auto select an available full vocal rather than a cover-artist quiz',async()=>{
 const probes=[],r=await chooseOnlineSource(title,[item(5),item(9,title,'另一位演唱者')],async id=>(probes.push(id),true));assert.equal(r.choice.item.id,'5');assert.deepEqual(probes,['5']);
});
test('an account sharing the title is not mistaken for an explicitly requested performer',async()=>{
 const r=await chooseOnlineSource(title,[item(5),item(9,title,title,{durationSec:30})],async()=>true);assert.equal(r.choice.item.id,'5');
});
test('genuinely different explicitly matched collaboration versions still require a choice',async()=>{
 const probes=[],r=await chooseOnlineSource(query,[item(5,title,'原作者甲 / 合作者乙'),item(9,title,'原作者甲 / 合作者丙')],async id=>(probes.push(id),true));assert.equal(r.choice,null);assert.equal(r.unavailable,false);assert.equal(r.ranked.length,2);assert.deepEqual(probes,[]);
});
test('valid explicit live alternatives are choices, not incorrectly reported as no source',async()=>{
 const r=await chooseOnlineSource(title+' Live',[item(5,title+' Live','演唱者甲'),item(9,title+' Live','演唱者乙')],async()=>true);assert.equal(r.choice,null);assert.equal(r.unavailable,false);assert.equal(r.ranked.length,2);
});
for(const engine of ['rvc','breeze'])test(engine+' fallback uses the saved voice/profile and sends exactly one selected output',async t=>{
 const root=mkdtempSync(join(tmpdir(),'online-fallback-')),starts=[],voices=[],texts=[];
 const state={engine,ready:true,rvcReady:true,busy:false,reuseFinished:false,selectedVoice:'breeze-fixture',voices:[{id:'breeze-fixture',name:'女声甲'}],rvcVoice:'rvc-fixture',rvcVoices:[{id:'rvc-fixture',name:'女声乙'}],breezeArrangement:'acappella',rvcArrangement:'mixed',keepMelody:2,rvcPitch:0,qqDurationSec:60};
 const studio={state:()=>state,search:async()=>({list:results}),start:spec=>{starts.push(spec);return {job:{id:'fixture-job'}};},status:()=>({job:{id:'fixture-job',...starts[0],status:'done',seconds:60}}),resultFile:(_id,arrangement)=>'fixture-'+arrangement+'.mp3'};
 const router=createQQRouter({root,studio,getConfig:()=>({enabled:true,ownerQQ:'fixture',song:{enabled:true}}),localSources:{match:()=>[]},canUseSong:async()=>true,sendText:async(...args)=>texts.push(args),sendVoice:async(...args)=>voices.push(args)});
 t.after(()=>{router.dispose();assert(resolve(root).startsWith(resolve(tmpdir())+sep+'online-fallback-'));rmSync(root,{recursive:true,force:true});});
 const started=router.intercept({song:query,chatId:'private:fixture'});assert(started.result.queued);await new Promise(r=>setImmediate(r));
 assert.equal(starts.length,1);assert.equal(starts[0].songId,'5');assert.equal(starts[0].engine,engine);assert.equal(starts[0].voice,engine+'-fixture');assert.equal(starts[0].reuseFinished,false);assert.equal(starts[0].durationSec,60);
 if(engine==='rvc')assert.equal(starts[0].pitch,0);else assert.equal(starts[0].keepMelody,2);
 await router.tick();await router.tick();assert.equal(voices.length,1);assert.equal(texts.length,0);assert.equal(router.status().requests[0].status,'sent');assert.equal(router.intercept({song:query,chatId:'private:fixture'}).result.reused,true);assert.equal(starts.length,1);
});
