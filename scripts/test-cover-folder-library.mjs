// Isolated folder ingestion only. Never invokes media models, network or QQ.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync,utimesSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep,parse} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createFolderLibrary,guessSongName} from '../assets/breeze-cover/folder-library.mjs';
import {createLocalSources,matchLocalSources} from '../assets/breeze-cover/local-sources.mjs';
import {createQQRouter} from '../assets/breeze-cover/qq-router.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'folder-ingest-')),data=join(root,'data'),folder=join(root,'music'),imports=join(data,'imports');for(const d of [folder,imports])mkdirSync(d,{recursive:true});
 let clock=Date.now(),sources=[],copied=0;const disposers=[];
 const importAudio=(name,bytes)=>{const filename=randomUUID()+'-'+name.replace(/[^\p{L}\p{N}_. -]/gu,'_').slice(-100);writeFileSync(join(imports,filename),bytes);const id='i-'+hash(filename).slice(0,18);sources.push({id,label:filename.slice(37),origin:'本机导入'});copied++;return {ok:true,sources};};
 const local=createLocalSources({root:data,getSources:()=>sources});
 const make=()=>createFolderLibrary({root:data,getSources:()=>sources,importAudio,localSources:local,now:()=>clock});let service=make();
 t.after(()=>{disposers.reverse().forEach(fn=>fn());service.dispose();assert(resolve(root).startsWith(resolve(tmpdir())+sep+'folder-ingest-'));rmSync(root,{recursive:true,force:true});});
 return {root,data,folder,local,service,importAudio,onClose:fn=>disposers.push(fn),advance:n=>clock+=n,clock:()=>clock,copied:()=>copied,sources:()=>sources,reload:()=>{service.dispose();service=make();return service;}};
}
test('filename inference separates title and performer, but does not invent original artists',()=>{
 assert.deepEqual(guessSongName('01_示例歌曲_翻唱者.m4a'),{title:'示例歌曲',artists:'翻唱者',aliases:['01_示例歌曲_翻唱者']});
 assert.equal(guessSongName('示例歌曲.mp3').title,'示例歌曲');assert.equal(guessSongName('03_示例歌曲（另一版）_某人.wav').title,'示例歌曲（另一版）');
});
test('registered folder persists and a newly stable file is ingested without another add operation',t=>{
 const f=fixture(t);f.service.add(f.folder);const file=join(f.folder,'01_示例歌曲_翻唱者.m4a');writeFileSync(file,'fixture-audio');utimesSync(file,new Date(f.clock()),new Date(f.clock()));
 let s=f.service.scan();assert.equal(s.lastResult.waiting,1);assert.equal(f.copied(),0);f.advance(4000);s=f.service.scan();assert.equal(s.lastResult.imported,1);assert.equal(s.scanning,false);assert.equal(f.local.match('示例歌曲').length,1);
 const again=f.reload();assert.equal(again.state().folders.length,1);again.scan();assert.equal(f.copied(),1);
});
test('existing imported content is linked by hash and retains the manually corrected name/credits',t=>{
 const f=fixture(t),bytes=Buffer.from('same fixture bytes');const before=f.importAudio('long-unhelpful-name.m4a',bytes).sources[0];f.local.set({sourceId:before.id,title:'用户登记歌名',artists:'标签演唱者',songArtists:['作品歌手'],aliases:['别名']});
 writeFileSync(join(f.folder,'another_name.m4a'),bytes);f.service.add(f.folder);const s=f.service.scan({force:true});assert.equal(s.lastResult.imported,0);assert.equal(s.lastResult.reused,1);assert.equal(f.copied(),1);assert.equal(f.local.list()[0].title,'用户登记歌名');assert.equal(f.local.match('用户登记歌名 作品歌手').length,1);
});
test('duplicate files do not create duplicate entries, and removing a watched directory deletes nothing',t=>{
 const f=fixture(t);for(const name of ['a.m4a','b.m4a'])writeFileSync(join(f.folder,name),'identical audio fixture');f.service.add(f.folder);f.service.scan({force:true});assert.equal(f.sources().length,1);assert.equal(f.service.state().lastResult.reused,1);
 const id=f.service.state().folders[0].id;f.service.remove(id);assert.equal(f.service.state().folders.length,0);assert.equal(readdirSync(join(f.data,'imports')).length,1);assert(existsSync(join(f.folder,'a.m4a')));
});
test('pause prevents automatic ingestion, while explicit manual scan is still available',t=>{
 const f=fixture(t);f.service.add(f.folder);f.service.enabled(false);writeFileSync(join(f.folder,'song.m4a'),'fixture');f.advance(10000);f.service.scan();assert.equal(f.copied(),0);f.service.scan({force:true});assert.equal(f.copied(),1);assert.equal(f.service.state().enabled,false);
});
test('only the explicit directory first level is scanned; relative paths and disk roots are rejected',t=>{
 const f=fixture(t);assert.throws(()=>f.service.add('relative/path'));assert.throws(()=>f.service.add(parse(f.folder).root));mkdirSync(join(f.folder,'nested'));writeFileSync(join(f.folder,'nested','hidden.m4a'),'fixture');writeFileSync(join(f.folder,'ignore.txt'),'fixture');f.service.add(f.folder);f.service.scan({force:true});assert.equal(f.copied(),0);
});
test('bounded batches continue next scan without losing or duplicating queued files',t=>{
 const f=fixture(t);for(let i=0;i<20;i++)writeFileSync(join(f.folder,'song_'+i+'.m4a'),'unique fixture '+i);f.service.add(f.folder);f.service.scan({force:true});assert.equal(f.copied(),16);assert.equal(f.service.state().lastResult.waiting,4);f.service.scan({force:true});assert.equal(f.copied(),20);assert.equal(f.service.state().lastResult.tracked,20);
});
test('a corrupt folder registry is not overwritten and cannot trigger unexpected imports',t=>{
 const f=fixture(t);f.service.dispose();const file=join(f.data,'source-folders.json');writeFileSync(file,'corrupt fixture');const bad=f.reload();assert.equal(bad.state().ok,false);assert.throws(()=>bad.scan());assert.equal(readFileSync(file,'utf8'),'corrupt fixture');assert.equal(f.copied(),0);
});
test('local title-first accepts another cover performer but preserves explicit version restrictions',()=>{
 const source={id:'i-aaaaaaaaaaaaaaaaaa',label:'示例歌曲_本地翻唱者.m4a',origin:'本机导入'},meta={[source.id]:{title:'示例歌曲',artists:'本地翻唱者',songArtists:[]}};
 for(const q of ['示例歌曲 原作品歌手','原作品歌手 示例歌曲','原作品歌手的示例歌曲'])assert.equal(matchLocalSources(q,[source],meta)[0].matchMode,'title-first');
 for(const q of ['示例歌曲 原唱版','示例歌曲 其他人版','示例歌曲 Live','示例歌曲新标题'])assert.equal(matchLocalSources(q,[source],meta).length,0,q);
 assert.equal(matchLocalSources('示例歌曲 本地翻唱者版',[source],meta)[0].matchMode,'explicit-performer');
});
test('RVC cached mode uses new local audio unless an exact legacy finished cover exists',async t=>{
 const f=fixture(t);writeFileSync(join(f.folder,'示例歌曲_本地翻唱者.m4a'),'fixture');f.service.add(f.folder);f.advance(10000);
 const starts=[],cfg={ownerQQ:'fixture',enabled:true,song:{enabled:true}},state=()=>({engine:'rvc',reuseFinished:true,rvcReady:true,ready:true,busy:false,rvcVoice:'rvc-fixture',rvcVoices:[{id:'rvc-fixture'}],rvcArrangement:'mixed',rvcPitch:0,qqDurationSec:10});
 const studio={state,findFinished:()=>null,start:spec=>{starts.push(spec);return {job:{id:'fixture-job'}};},search:()=>assert.fail('Must not search')};
 const router=createQQRouter({root:join(f.root,'router'),getConfig:()=>cfg,studio,localSources:f.local,refreshLocal:()=>f.service.scan(),getLegacyMatch:()=>({kind:'none'}),sendText:()=>assert.fail('No QQ'),sendVoice:()=>assert.fail('No QQ')});f.onClose(()=>router.dispose());
 const result=router.intercept({chatId:'private:fixture',song:'示例歌曲 原作品歌手'});await new Promise(r=>setImmediate(r));assert(result.handled);assert.equal(starts.length,1);assert.equal(starts[0].sourceId,f.sources()[0].id);assert.equal(starts[0].reuseFinished,true);
 const other=createQQRouter({root:join(f.root,'router2'),getConfig:()=>cfg,studio,localSources:f.local,getLegacyMatch:()=>({kind:'match'}),sendText:()=>{},sendVoice:()=>{}});f.onClose(()=>other.dispose());assert.equal(other.intercept({chatId:'private:fixture',song:'示例歌曲'}).handled,false);
});
test('folder and song-name controls change sources only, never voice settings or QQ',async()=>{
 const source={id:'i-aaaaaaaaaaaaaaaaaa',label:'示例歌曲_翻唱者.m4a',origin:'本机导入'},song={...source,title:'示例歌曲',artists:'翻唱者',songArtists:['作品歌手'],aliases:['别名']};
 const data={ok:true,profile:{engine:'rvc',engineName:'RVC',voiceName:'fixture',arrangementName:'带伴奏',ready:true,pitch:0},reuseFinished:true,sources:[source],localSongs:[song],jobs:[],qq:{active:false,guardInstalled:true,requests:[]},folderLibrary:{enabled:true,folders:[],lastResult:null}};
 const values=[data,source.id,'local','',[],'','0','10','','','','fixture-folder',{[source.id]:'新登记歌名'}],calls=[];
 const React={Fragment:'Fragment',useState:x=>[values.length?values.shift():x,()=>{}],useEffect:()=>{}},h=(type,props,...children)=>({type,props,children}),ui=Object.fromEntries(['Card','Btn','Row','Select'].map(k=>[k,k]));
 const Comp=new Function('React','h','ui','call',readFileSync(new URL('../assets/breeze-cover/panel.js',import.meta.url),'utf8'))(React,h,ui,async(p,b)=>{if(b)calls.push({p,b});return data;}),tree=Comp({toast:()=>{}}),nodes=[];function walk(x){if(x&&typeof x==='object'){nodes.push(x);(x.children||[]).flat(Infinity).forEach(walk);}}walk(tree);
 await nodes.find(n=>n.children?.includes('添加目录并扫描')).props.onClick();assert.deepEqual(calls[0],{p:'/folders',b:{action:'add',path:'fixture-folder'}});
 await nodes.find(n=>n.props?.role==='switch').props.onClick();assert.deepEqual(calls[1],{p:'/folders',b:{action:'enabled',enabled:false}});
 await nodes.find(n=>n.children?.includes('保存歌名')).props.onClick();assert.deepEqual(calls[2].b,{sourceId:source.id,title:'新登记歌名',artists:song.artists,songArtists:song.songArtists,aliases:song.aliases});assert(!calls.some(x=>['/start','/send','/settings'].includes(x.p)));
});
