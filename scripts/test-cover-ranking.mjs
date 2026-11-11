// Pure fixtures; no music downloads, generation or QQ access.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chooseCandidate,selectCandidate,rankCandidates,createQQRouter} from '../assets/breeze-cover/qq-router.mjs';
const songs=[
 {id:'1',name:'遇见',artists:'孙燕姿'},
 {id:'2',name:'遇见 (Live)',artists:'孙燕姿'},
 {id:'3',name:'遇见(Live)',artists:'孙燕姿'},
 {id:'4',name:'遇见',artists:'孙燕姿'},
 {id:'5',name:'孙燕姿-遇见（小7 remix）',artists:'小7'}
];
test('the exact five reported results automatically pick the first studio original-artist entry',()=>{
 assert.equal(chooseCandidate('遇见',songs).id,'1');assert.equal(chooseCandidate('孙燕姿 遇见',songs).id,'1');
 assert.equal(chooseCandidate('孙燕姿的遇见 官方版',songs).id,'1');
 assert.equal(chooseCandidate('遇见',[songs[1],songs[2],songs[4],songs[3],songs[0]]).id,'4');
 assert.match(selectCandidate('遇见',songs).reason,/普通录音室/);
});
test('explicit live requests are honored instead of silently changed to studio',()=>{
 for(const q of ['遇见 Live','遇见 现场版','孙燕姿 遇见 演唱会版','遇见(Live)'])assert.equal(chooseCandidate(q,songs).id,'2',q);
 assert.equal(chooseCandidate('遇见 现场版',[songs[0],songs[3]]),null);
 assert.equal(chooseCandidate('遇见 不要Live',songs).id,'1');assert.equal(chooseCandidate('遇见 非现场版',songs).id,'1');
});
test('different unmarked artists are not falsely labelled original or official',()=>{
 const list=[songs[0],{id:'6',name:'遇见',artists:'翻唱歌手但未标版'}];
 assert.equal(chooseCandidate('遇见',list),null);
 assert.equal(chooseCandidate('孙燕姿 遇见',list).id,'1');
 assert.equal(chooseCandidate('王菲 遇见',list),null);
 assert.equal(chooseCandidate('遇见',[{name:'遇见',artists:'甲'},{name:'遇见',artists:'乙'}]),null);
});
test('all nonstudio markers, including aliases, rank behind ordinary versions',()=>{
 const list=['Live','Remix','Cover','Instrumental','Demo','现场版','翻唱版','伴奏版'].map((v,i)=>({id:String(20+i),name:'夜曲 ('+v+')',artists:'周杰伦'}));
 list.push({id:'30',name:'夜曲',artists:'周杰伦',alias:'演唱会 Live'}, {id:'31',name:'夜曲',artists:'周杰伦'});
 assert.equal(chooseCandidate('周杰伦 夜曲',list).id,'31');
 assert.equal(chooseCandidate('周杰伦 夜曲 Remix',list).id,'21');
 assert.equal(chooseCandidate('周杰伦 夜曲 不要现场版',list).id,'31');
});
test('title matching is exact enough to refuse artist mismatches and unrelated results',()=>{
 assert.equal(chooseCandidate('夜曲',[{id:1,name:'夜曲前奏',artists:'周杰伦'}]),null);
 assert.equal(chooseCandidate('听海',[{id:1,name:'海',artists:'张惠妹'}]),null);
 assert.equal(chooseCandidate('未命中',songs),null);
 assert.equal(chooseCandidate('遇见',[songs[0],songs[0]]).id,'1');
 assert.equal(chooseCandidate('夜曲 Live',[{id:1,name:'夜曲 - Live',artists:'周杰伦'}]).id,1);
});
test('equal studio duplicates use search rank, not song ID or membership permissions',()=>{
 const list=[{id:'999',name:'遇见',artists:'孙燕姿',vip:true},{id:'1',name:'遇见',artists:'孙燕姿',vip:false}];
 assert.equal(chooseCandidate('遇见',list).id,'999');assert.equal(rankCandidates('遇见',list).length,2);
});
test('explicit original-artist clues in separate cover metadata resolve real homonymous search results',()=>{
 const live=[songs[0],{id:'7',name:'恶作剧',artists:'林依晨'},{id:'8',name:'遇见',artists:'郑润泽'},{id:'9',name:'遇见',artists:'零零',alias:'翻自：孙燕姿'},{id:'10',name:'遇见（Live）',artists:'房东的猫'},songs[1]];
 assert.equal(chooseCandidate('遇见',live).id,'1');assert.equal(chooseCandidate('郑润泽 遇见',live).id,'8');assert.equal(chooseCandidate('遇见 live',live).id,'2');
 const conflicting=[...live,{id:'11',name:'遇见',artists:'另一个翻唱者',alias:'翻自：郑润泽'}];assert.equal(chooseCandidate('遇见',conflicting),null);
});
test('router starts exactly one automatic job without a choice prompt and persists source metadata',async()=>{
 const root=mkdtempSync(join(tmpdir(),'auto-song-fixture-')),starts=[],texts=[];
 const cfg={enabled:true,ownerQQ:'fixture',song:{enabled:true}};
 const studio={state:()=>({engine:'breeze',ready:true,busy:false,voices:[{id:'voice',name:'fixture voice'}],selectedVoice:'voice',qqDurationSec:60,breezeArrangement:'acappella',keepMelody:1}),search:async()=>({list:songs}),start:a=>{starts.push(a);return {job:{id:'fixture-job'}};}};
 const router=createQQRouter({root,getConfig:()=>cfg,studio,sendText:async(...a)=>texts.push(a),sendVoice:async()=>assert.fail('not allowed')});
 try{const request=router.intercept({chatId:'private:fixture',song:'遇见 清唱'});await new Promise(r=>setImmediate(r));assert(request.result.ok);assert.equal(starts.length,1);assert.equal(starts[0].songId,'1');assert.equal(starts[0].voice,'voice');assert.equal(starts[0].arrangement,'acappella');assert.equal(texts.length,0);assert.equal(router.status().requests[0].sourceSelection.mode,'auto');assert.equal(router.status().requests[0].status,'queued');assert.equal(router.intercept({chatId:'private:fixture',song:'遇见 清唱'}).result.reused,true);assert.equal(starts.length,1);}
 finally{router.dispose();rmSync(root,{recursive:true,force:true});}
});
