// Source identity is separate from reusing an old voice. All data is fictitious.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {sourceHint} from '../assets/song-library/library.mjs';
import {chooseCandidate,createQQRouter} from '../assets/breeze-cover/qq-router.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const entry={title:'示例歌曲',artist:'示例演唱者',version:'猫猫DJ版',aliases:['示例歌曲猫猫DJ版'],voice:'old-voice',pitch:12,arrangement:'mixed',file:'not-an-input.mp3',vocalFile:'already-converted.wav',songId:'123456'};
function temp(t){const root=mkdtempSync(join(tmpdir(),'source-hint-')),offs=[];t.after(()=>{offs.reverse().forEach(f=>f());assert(resolve(root).startsWith(resolve(tmpdir())+sep+'source-hint-'));rmSync(root,{recursive:true,force:true});});return {root,offs};}
test('known DJ/version aliases participate in NetEase selection without weakening singer identity',()=>{
 const candidates=[{id:'123456',name:'示例歌曲',artists:'示例演唱者',alias:'猫猫DJ版'}];assert.equal(chooseCandidate('示例歌曲 猫猫DJ版',candidates)?.id,'123456');assert.equal(chooseCandidate('示例歌曲 狗狗DJ版',candidates),null);
 assert.equal(chooseCandidate('示例歌曲 原作品歌手',[{id:'2',name:'示例歌曲',artists:'翻唱者',alias:'翻自：原作品歌手'}]),null,'A credit is not a version alias');
});
test('legacy index recovers only original song ID, not old voice, pitch, cover or converted vocals',t=>{
 const {root}=temp(t);writeFileSync(join(root,'歌曲库索引.json'),JSON.stringify({version:1,items:[entry,{...entry,arrangement:'acappella',voice:'other-old-voice',version:'猫猫DJ版·清唱无伴奏'}]}));
 const hint=sourceHint(root,'示例歌曲 猫猫DJ版');assert.equal(hint.kind,'source');assert.equal(hint.songId,'123456');assert.equal(hint.version,'猫猫DJ版');for(const k of ['file','vocalFile','voice','pitch'])assert.equal(hint[k],undefined);
 assert.equal(sourceHint(root,'示例歌曲 猫猫DJ版 原作品歌手').songId,'123456','A supplied original credit must not block the known cover/remix source');
 assert.equal(sourceHint(root,'示例歌曲 原唱版'),null);assert.equal(sourceHint(root,'示例歌曲 狗狗DJ版'),null);
});
test('ambiguous distinct source IDs are not silently merged',t=>{
 const {root}=temp(t);writeFileSync(join(root,'歌曲库索引.json'),JSON.stringify({version:1,items:[entry,{...entry,songId:'654321'}]}));assert.equal(sourceHint(root,'示例歌曲 猫猫DJ版').kind,'ambiguous');
});
test('fresh RVC follows an indexed song ID without searching, replaying old voice or inheriting old pitch',async t=>{
 const {root,offs}=temp(t),starts=[],cfg={enabled:true,ownerQQ:'fixture',song:{enabled:true}},state=()=>({engine:'rvc',rvcReady:true,busy:false,reuseFinished:false,rvcVoice:'new-voice',rvcVoices:[{id:'new-voice'}],rvcArrangement:'mixed',rvcPitch:0,qqDurationSec:60});
 const studio={state,search:()=>assert.fail('No search when source identity exists'),start:s=>{starts.push(s);return {job:{id:'fixture'}};}};
 const router=createQQRouter({root,getConfig:()=>cfg,studio,getLibrarySource:()=>({kind:'source',id:'123456',songId:'123456',name:entry.title,artists:entry.artist,version:entry.version}),sendText:()=>assert.fail('No choice prompt'),sendVoice:()=>assert.fail('No QQ')});offs.push(()=>router.dispose());
 const r=router.intercept({chatId:'private:fixture',song:'示例歌曲 猫猫DJ版'});await new Promise(r=>setImmediate(r));assert(r.result.ok);assert.equal(starts[0].songId,'123456');assert.equal(starts[0].voice,'new-voice');assert.equal(starts[0].pitch,0);assert.equal(starts[0].reuseFinished,false);assert.equal(starts[0].file,undefined);assert.equal(router.status().requests[0].sourceSelection.origin,'library-source');
});
test('stale failed records are labelled superseded, and retry uses current defaults instead of old pitch',t=>{
 const {root,offs}=temp(t),calls=[],old={id:'old-fixture',status:'source_unavailable',selectionRevision:'old-rule',query:'示例歌曲 猫猫DJ版',sourcePreference:'auto',spec:{voice:'old-voice',pitch:12},ownerStamp:sha('fixture'),createdAt:1};writeFileSync(join(root,'qq-requests.json'),JSON.stringify([old]));
 const router=createQQRouter({root,getConfig:()=>({ownerQQ:'fixture'}),studio:{state:()=>({busy:false})},dispatchRequest:args=>{calls.push(args);return {ok:true,queued:true};},sendText:()=>assert.fail('Do not send on load'),sendVoice:()=>assert.fail('Do not send on load')});offs.push(()=>router.dispose());assert.equal(router.status().requests[0].status,'superseded');assert.equal(calls.length,0);router.setGuard(true);assert(router.retry(old.id).ok);assert.deepEqual(calls,[{song:old.query,chatId:'private:fixture'}]);
});
test('retry never resends already sent/uncertain tasks or bypasses the current owner',t=>{
 const {root,offs}=temp(t);writeFileSync(join(root,'qq-requests.json'),JSON.stringify([{id:'sent',status:'sent'},{id:'uncertain',status:'delivery_uncertain'},{id:'other',status:'superseded',ownerStamp:sha('another-owner')}].map(x=>({...x,createdAt:1}))));
 const router=createQQRouter({root,getConfig:()=>({ownerQQ:'fixture'}),studio:{state:()=>({busy:false})},dispatchRequest:()=>assert.fail('Do not send'),sendText:()=>{},sendVoice:()=>{}});offs.push(()=>router.dispose());router.setGuard(true);assert.throws(()=>router.retry('sent'));assert.throws(()=>router.retry('uncertain'));assert.throws(()=>router.retry('other'),/主人/);
});
test('retry button visibly uses the current profile revision and labels old records',async()=>{
 const data={ok:true,profile:{revision:'current-profile',ready:true,engineName:'RVC',voiceName:'new-voice',arrangementName:'带伴奏'},sources:[],jobs:[],qq:{active:false,guardInstalled:true,selectionRevision:'new-rule',requests:[{id:'old',query:'示例歌曲',engine:'rvc',voiceName:'old-voice',arrangement:'mixed',status:'superseded',message:'旧规则记录',createdAt:1}]}};
 const values=[data,'','local','',[],'','0','10','','','','',{}],calls=[],React={Fragment:'Fragment',useState:x=>[values.length?values.shift():x,()=>{}],useEffect:()=>{}},h=(type,props,...children)=>({type,props,children}),ui=Object.fromEntries(['Card','Btn','Row','Select'].map(k=>[k,k]));
 const Comp=new Function('React','h','ui','call',readFileSync(new URL('../assets/breeze-cover/panel.js',import.meta.url),'utf8'))(React,h,ui,async(p,b)=>{if(b)calls.push({p,b});return data;}),tree=Comp({toast:()=>{}}),nodes=[];function walk(n){if(n&&typeof n==='object'){nodes.push(n);(n.children||[]).flat(Infinity).forEach(walk);}}walk(tree);assert(nodes.some(n=>n.children?.some(s=>typeof s==='string'&&s.includes('历史未制作记录'))));
 await nodes.find(n=>n.children?.includes('按当前设置重试（制作后发QQ）')).props.onClick();assert.deepEqual(calls,[{p:'/qq/retry',b:{id:'old',profileRevision:'current-profile'}}]);
});
