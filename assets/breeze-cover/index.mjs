import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {savedProfile,taskFromSavedProfile} from './saved-profile.mjs?ui=reuse1';
import {createStudio} from './studio.mjs?routing=reuse1';
import {createQQRouter,installNativeGuard,cleanQuery,sourcePreference} from './qq-router.mjs?routing=onlinefallback2';
import {createLocalSources} from './local-sources.mjs?autolibrary1';
import {createFolderLibrary,guessSongName} from './folder-library.mjs?autolibrary1';
export default {
 id:'breeze-cover',name:'翻唱制作',version:'1.6.1',api:1,panel:'panel.js',
 description:'统一QQ点歌引擎；本机制作、清唱/伴奏分开；记录实际引擎和音色，不静默回退。',
 defaults:{engine:'rvc',qqDurationSec:10,reuseFinished:true,breezeVoice:'sajiao_text_v2',keepMelody:0,breezeArrangement:'mixed',rvcArrangement:'mixed'},
 setup(api){
  const store=api.lib('core/store.js'),netease=api.lib('song/netease.js');
  const studio=createStudio({root:api.dataDir(),songWork:store.dataDir('songs'),workspace:api.config().workspaceDir||api.config().workspace,worker:join(api.dir,'separate.py'),getConfig:api.config,getSettings:api.settings,saveSettings:api.saveSettings,getBreeze:()=>api.use('voice'),getSong:()=>api.use('song'),resolveSongUrl:id=>netease.songUrl(id,{cookie:api.config().song?.neteaseCookie}),search:q=>typeof netease.searchSongs==='function'?netease.searchSongs(q,{cookie:api.config().song?.neteaseCookie,limit:30}):api.use('song')?.search(q),log:api.log});
  const localSources=createLocalSources({root:api.dataDir(),getSources:()=>studio.state().sources});
  const folderLibrary=createFolderLibrary({root:api.dataDir(),getSources:()=>studio.state().sources,importAudio:studio.importAudio,localSources});
  const router=createQQRouter({root:api.dataDir(),getConfig:api.config,studio,localSources,refreshLocal:()=>folderLibrary.scan(),getLegacyMatch:q=>api.use('song-library')?.preview?.(q),getLibrarySource:q=>api.use('song-library')?.sourceHint?.(q),dispatchRequest:args=>api.use('song').request(args),canUseSong:async id=>{const r=await netease.songUrl(id,{cookie:api.config().song?.neteaseCookie});return !!r?.url&&!r.trial;},sendText:api.sendText,sendVoice:api.sendVoiceFile,log:api.log});
  api.every(5000,()=>{try{folderLibrary.scan();}catch(error){api.log.warn?.('自动入库未完成：'+error.message);}},'扫描用户指定的本地原曲目录（不翻唱、不发QQ）');
  installNativeGuard(api,router);api.every(1000,()=>router.tick(),'发送已核对引擎的QQ点歌结果');
  api.onDispose(()=>{folderLibrary.dispose();router.dispose();studio.dispose();});
  const state=()=>{const s=studio.state();let localSongs=[],localSongError='';try{localSongs=localSources.list();}catch(error){localSongError=error.message;}return {...s,profile:savedProfile(s),qq:router.status(),folderLibrary:folderLibrary.state(),localSongs,localSongError};};
  const body=async req=>{const b=await api.core.http.raw(req,256*1024);try{return JSON.parse(b.toString('utf8')||'{}');}catch{throw Error('请求格式错误');}};
  const safe=fn=>async(...args)=>{try{return await fn(...args);}catch(error){return {ok:false,message:String(error.message||error)};}};
  const createLocal=args=>{if(router.active())throw Error('QQ点歌已有任务，未重复启动本机翻唱');return studio.start(args);};
  api.route('/state',state);api.route('/settings',safe(async req=>{const b=await body(req);if(b.rvcVoice!==undefined&&!studio.state().rvcVoices.some(v=>v.id===b.rvcVoice))throw Error('请选择列表中的RVC音色');studio.selectSettings(b);if(b.rvcVoice!==undefined)api.setConfig({song:{voice:b.rvcVoice}});return {...state(),message:'引擎和参数已保存；主人QQ点歌与新打开的制作页共用。不会立即制作或发送。'};}));
  api.route('/sources',()=>({ok:true,list:state().sources}));api.route('/search',safe(req=>studio.search(api.core.http.query(req).q)));
  api.route('/local-sources',()=>({ok:true,list:localSources.list()}));
  api.route('/local-source',safe(async req=>localSources.set(await body(req))));
  api.route('/folders',safe(async req=>{const b=await body(req);if(b.action==='add'){folderLibrary.add(b.path);folderLibrary.scan({force:true});}else if(b.action==='remove')folderLibrary.remove(b.id);else if(b.action==='enabled')folderLibrary.enabled(b.enabled);else if(b.action==='scan')folderLibrary.scan({force:true});else throw Error('未知目录操作');return {...state(),message:'原曲目录已更新；只入库，不开始翻唱或发送QQ'};}));
  api.route('/source-preview',safe(req=>{const text=api.core.http.query(req).q||'',query=cleanQuery(text),preference=sourcePreference(text),matches=preference==='netease'?[]:localSources.match(query);if(matches.length||preference==='local')return {ok:true,query,preference,route:matches.length===1?'local':matches.length>1?'needs_choice':'missing_local',matches};const hint=api.use('song-library')?.sourceHint?.(query);return {ok:true,query,preference,route:hint?.kind==='source'?'library-source':hint?.kind==='ambiguous'?'needs_choice':'netease',matches:hint?.kind==='source'?[hint]:hint?.candidates||[]};}));
  api.route('/start',safe(async req=>createLocal(taskFromSavedProfile(studio.state(),await body(req)))));api.route('/job',safe(req=>studio.status(api.core.http.query(req).id)));api.route('/cancel',safe(async req=>studio.cancel((await body(req)).id)));
  api.route('/reuse-preview',safe(async req=>{const args=taskFromSavedProfile(studio.state(),await body(req)),found=studio.findFinished(args);return {ok:true,reuseFinished:args.reuseFinished,match:!!found,job:found?.job||null};}));
  api.route('/qq/choose',safe(async req=>{const b=await body(req);return router.choose(b.id,b.index);}));
  api.route('/qq/resume',safe(async req=>router.resume((await body(req)).id)));
  api.route('/qq/retry',safe(async req=>{const b=await body(req);if(b.profileRevision!==state().profile.revision)throw Error('当前声音设置已变化，请刷新核对后重试');return router.retry(b.id);}));
  api.route('/import',safe(async req=>{const name=api.core.http.query(req).name||'',before=new Set(studio.state().sources.map(s=>s.id)),r=studio.importAudio(name,await api.core.http.raw(req,64*1024*1024));const added=studio.state().sources.find(s=>s.origin==='本机导入'&&!before.has(s.id));if(added)localSources.set({sourceId:added.id,...guessSongName(name)});return {...state(),message:r.message};}));
  api.route('/audio',(req,res)=>{const q=api.core.http.query(req);try{api.core.http.send(res,200,readFileSync(studio.resultFile(q.id,q.arrangement)),'audio/mpeg');}catch(error){api.core.http.send(res,404,{ok:false,message:error.message});}});
  async function send(id,arrangement,expectedEngine,expectedVoice){
   const cfg=api.config();if(!cfg.enabled||cfg.dryRun)throw Error('QQ功能关闭或正在试运行，未发送');
   const job=studio.status(id).job;if(!['mixed','acappella'].includes(arrangement))throw Error('请明确选择发送清唱还是带伴奏版');
   if(expectedEngine&&expectedEngine!==job.engine||expectedVoice&&expectedVoice!==job.voice)throw Error('成品引擎或音色与选择不符，已阻止发送');
   const file=studio.resultFile(id,arrangement),label=job.engine==='breeze'?'Breeze CPP':'RVC';
   await api.sendVoiceFile('private:'+cfg.ownerQQ,file,'[翻唱成品·'+label+'·'+job.voiceName+'·'+(arrangement==='acappella'?'清唱':'带伴奏')+'·'+id.slice(0,8)+'] '+job.title);
   return {ok:true,engine:job.engine,voice:job.voice,arrangement,jobId:id,message:'已提交发送：'+label+' / '+job.voiceName+' / '+(arrangement==='acappella'?'清唱':'带伴奏')+'；收件播放未确认。'};
  }
  api.route('/send',safe(async req=>{const b=await body(req);return send(b.id,b.arrangement,b.expectedEngine,b.expectedVoice);}));
  const owner=sessionId=>{if(!api.core.hub.turnHasOwner(sessionId))throw Error('仅主人可使用本机翻唱');};
  api.command({name:'coverpick',aliases:['翻唱选歌'],desc:'确认待制作歌曲来源：/coverpick 请求ID 序号',run:(arg,msg)=>{
   if(msg?.kind!=='private'||!api.isOwner(msg.userId)||msg.chatId!=='private:'+api.config().ownerQQ)return '仅主人私聊可确认此翻唱请求';
   if(msg.raw?.simulated)return '模拟中不确认歌曲、不制作、不发送';
   try{const [id,index]=String(arg).trim().split(/\s+/);return router.choose(id,Number(index)).message;}catch(error){return error.message;}
  }});
  api.tool?.(({chat,level,sessionId})=>{
   if(level!=='full'||chat.kind!=='private')return [];
   return [
    api.defineTool({name:'breeze_cover_sources',description:'列本机来源和点歌歌名、实际音色及当前引擎；query非空仅手动搜索网易云候选。QQ唱歌直接调用qq_song_cover，会自动先查本地，不必预先搜网易云。只是查询。',properties:{query:{type:'string'}},required:[],execute:async({query})=>{owner(sessionId);return query?studio.search(query):{ok:true,sources:state().sources,localSongs:localSources.list(),voices:state().voices,rvcVoices:state().rvcVoices,engine:state().engine,qq:router.status()};}}),
    api.defineTool({name:'breeze_cover_create',description:'仅本机制作，不自动发送。engine缺省使用面板统一引擎。QQ点歌优先调用qq_song_cover（已按统一引擎路由），同一请求不要同时调用这两个制作工具。来源必须已确认，先做10秒。',properties:{sourceId:{type:'string'},songId:{type:'string'},title:{type:'string'},file:{type:'string'},engine:{type:'string',enum:['breeze','rvc']},voice:{type:'string'},arrangement:{type:'string',enum:['mixed','acappella']},startSec:{type:'number'},durationSec:{type:'number'},keepMelody:{type:'integer',enum:[0,1,2]},pitch:{type:'integer'},lyrics:{type:'string'}},required:[],execute:async args=>{owner(sessionId);return createLocal(args);}}),
    api.defineTool({name:'breeze_cover_status',description:'查询/取消本机翻唱，不会发QQ。',properties:{id:{type:'string'},cancel:{type:'boolean'}},required:['id'],execute:async({id,cancel})=>{owner(sessionId);return cancel?studio.cancel(id):studio.status(id);}}),
    api.defineTool({name:'breeze_cover_pick',description:'仅主人明确确认待选歌曲版本后调用。传QQ请求ID和候选序号，继续原请求，不新建重复任务。',properties:{id:{type:'string'},index:{type:'integer'}},required:['id','index'],execute:async({id,index})=>{owner(sessionId);return router.choose(id,index);}}),
    api.defineTool({name:'breeze_cover_send',description:'仅主人明确要求发送本机成品时调用。QQ路由任务会自行发送一次，不能再重复调用此工具。必须明确版本；返回实际引擎、音色和任务ID。',properties:{id:{type:'string'},arrangement:{type:'string',enum:['mixed','acappella']},expectedEngine:{type:'string',enum:['breeze','rvc']},expectedVoice:{type:'string'}},required:['id','arrangement'],execute:async({id,arrangement,expectedEngine,expectedVoice})=>{owner(sessionId);return send(id,arrangement,expectedEngine,expectedVoice);}})
   ];
  });
  api.rule?.(()=> '翻唱已统一路由：主人QQ默认引擎='+state().engine+'。成品优先开关='+(state().reuseFinished!==false?'开启：仅复用当前引擎音色和参数匹配的成品':'关闭：必须重新换声，不能播放旧成品；仍可复用分离的人声伴奏缓存')+'；明确说重新翻唱/重做同样必须重新换声。此开关对Breeze和RVC都生效，关闭时RVC也走统一制作以绕过旧的最终成品缓存。请把重新翻唱等词保留传给工具。QQ点歌用qq_song_cover，入口会严格按选中引擎处理；不要同时调用breeze_cover_create或另开RVC脚本。Breeze QQ先按歌名精确匹配已导入本地原曲及登记别名，没有才搜网易云；本地多个匹配先确认，禁止跳过本地直接搜网或自动选择另一引擎。明确说网易云则保留该词，仅搜网易云；明确说本地则保留该词，未命中就报告而不搜网。普通点歌不要预先用breeze_cover_sources搜索网易云，直接传用户原歌名给qq_song_cover。用户只说歌名时，不因内置工具建议带歌手而擅自补入原唱名。本地以登记歌名为主，允许使用任何人的翻唱，不要求原唱本人；普通歌手词只作作品提示，明确指定某人版/原唱版才限制来源。网易云同样原唱优先而非必须原唱：没有原唱或原唱完整音频不可用时，自动选择可取得完整音频的同名普通演唱来源，排除钢琴、纯音乐、伴奏和Type Beat；不要把替代演唱者说成原唱。用户没有指定变调时，不要按男女声音擅自传pitch（例如+12），留空沿用面板。已知合唱歌手支持组合匹配。只扫描用户已登记的目录，新歌会自动入库但不会自动唱；未登记的目录不扫描，也不宣称已匹配。本地原曲不是已完成的翻唱成品，仍用当前声音设置制作。Breeze失败/未就绪必须报告，禁止以RVC或旧歌曲库成品代替。网易云来源自动优先普通录音室版，同歌手同歌名重复条目按搜索顺序选择；Live、Remix、翻唱排后。明确要现场或混音时保留这些词传给qq_song_cover。不要因为搜索有多个结果就预先要求/coverpick；仅工具返回等待选歌时才让主人确认，也可用面板按钮。无法仅靠标题保证官方母带。QQ任务完成后只自动提交一次指定版本，不能再调用breeze_cover_send重复发。breeze_cover_create仅本机试听。清唱与伴奏分开，实际结果以任务engine/voice为准。实验换声可能跑调，不承诺保真。');
  return {...studio,state,createLocal,send,resolveEngine:router.resolveEngine,hasUnifiedFinished:router.hasUnifiedFinished,qqStatus:router.status};
 }
};
