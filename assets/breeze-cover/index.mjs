import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createStudio} from './studio.mjs';
export default {
 id:'breeze-cover',name:'Breeze翻唱',version:'1.0.3',api:1,panel:'panel.js',
 description:'本机歌曲→分离→Breeze/RVC换声→清唱或带伴奏；先试听，不自动发QQ。',
 defaults:{breezeVoice:'sajiao_text_v2',keepMelody:0,breezeArrangement:'mixed',rvcArrangement:'mixed'},
 setup(api){
  const store=api.lib('core/store.js'),netease=api.lib('song/netease.js');
  const studio=createStudio({root:api.dataDir(),songWork:store.dataDir('songs'),workspace:api.config().workspaceDir||api.config().workspace,worker:join(api.dir,'separate.py'),getConfig:api.config,getSettings:api.settings,saveSettings:api.saveSettings,getBreeze:()=>api.use('voice'),getSong:()=>api.use('song'),resolveSongUrl:id=>netease.songUrl(id,{cookie:api.config().song?.neteaseCookie}),search:q=>api.use('song')?.search(q),log:api.log});
  api.onDispose(()=>studio.dispose());
  const body=async req=>{const b=await api.core.http.raw(req,256*1024);try{return JSON.parse(b.toString('utf8')||'{}');}catch{throw Error('请求格式错误');}};
  api.route('/state',()=>studio.state());api.route('/settings',async req=>studio.selectSettings(await body(req)));api.route('/sources',()=>({ok:true,list:studio.state().sources}));
  api.route('/search',async req=>studio.search(api.core.http.query(req).q));api.route('/start',async req=>studio.start(await body(req)));api.route('/job',req=>studio.status(api.core.http.query(req).id));api.route('/cancel',async req=>studio.cancel((await body(req)).id));
  api.route('/import',async req=>studio.importAudio(api.core.http.query(req).name||'',await api.core.http.raw(req,64*1024*1024)));
  api.route('/audio',(req,res)=>{const q=api.core.http.query(req);try{const file=studio.resultFile(q.id,q.arrangement);api.core.http.send(res,200,readFileSync(file),'audio/mpeg');}catch(error){api.core.http.send(res,404,{ok:false,message:error.message});}});
  async function send(id,arrangement){const cfg=api.config();if(!cfg.enabled||cfg.dryRun)throw Error('QQ功能关闭或正在试运行，未发送');const job=studio.status(id).job;const mode=arrangement;if(!['mixed','acappella'].includes(mode))throw Error('请明确选择发送清唱还是带伴奏版');const file=studio.resultFile(id,mode);await api.sendVoiceFile('private:'+cfg.ownerQQ,file,'[本机翻唱·'+job.engine+'·'+(mode==='acappella'?'清唱':'带伴奏')+'] '+job.title);return {ok:true,message:'已提交发送所选版本；播放效果需收件人确认。'};}
  api.route('/send',async req=>{const b=await body(req);return send(b.id,b.arrangement);});
  const owner=(sessionId)=>{if(!api.core.hub.turnHasOwner(sessionId))throw Error('仅主人可使用本机翻唱');};
  api.tool?.(({chat,level,sessionId})=>{
   if(level!=='full'||chat.kind!=='private')return [];
   return [
    api.defineTool({name:'breeze_cover_sources',description:'列出本机已导入/缓存的原曲；query非空时搜索网易云歌曲候选。只是查询，不制作、不发送。',properties:{query:{type:'string'}},required:[],execute:async({query})=>{owner(sessionId);return query?studio.search(query):{ok:true,sources:studio.state().sources,voices:studio.state().voices,rvcVoices:studio.state().rvcVoices};}}),
    api.defineTool({name:'breeze_cover_create',description:'本机制作Breeze实验翻唱或RVC翻唱。先用10秒试听，sourceId取本机来源列表，或songId取已确认的网易云版本。arrangement=mixed带伴奏/acappella清唱；结果不自动发送QQ。返回任务ID后查询状态。Breeze无需RVC模型，不能把Breeze声音交给qq_song_cover。',properties:{sourceId:{type:'string'},songId:{type:'string'},title:{type:'string'},file:{type:'string',description:'仅限主人已导入的歌曲/QQ工作区/既有歌曲缓存内绝对路径'},engine:{type:'string',enum:['breeze','rvc']},voice:{type:'string'},arrangement:{type:'string',enum:['mixed','acappella']},startSec:{type:'number'},durationSec:{type:'number',description:'1–180秒，默认10秒'},keepMelody:{type:'integer',enum:[0,1,2]},pitch:{type:'integer',description:'仅RVC：-24到24半音，默认沿用现有设置'},lyrics:{type:'string',description:'对应片段歌词可选，最多1200字'}},required:[],execute:async args=>{owner(sessionId);return studio.start(args);}}),
    api.defineTool({name:'breeze_cover_status',description:'查询本机翻唱任务进度及完成文件；可取消。不会发QQ。',properties:{id:{type:'string'},cancel:{type:'boolean'}},required:['id'],execute:async({id,cancel})=>{owner(sessionId);return cancel?studio.cancel(id):studio.status(id);}}),
    api.defineTool({name:'breeze_cover_send',description:'仅当主人明确要求把已完成版本发到QQ时调用。只发主人私聊；必须使用正确的mixed/acappella版本，不重新制作。',properties:{id:{type:'string'},arrangement:{type:'string',enum:['mixed','acappella']}},required:['id','arrangement'],execute:async({id,arrangement})=>{owner(sessionId);return send(id,arrangement);}})
   ];
  });
  api.rule?.(()=> '已安装本机Breeze翻唱：用户明确用Breeze或指定.breeze讲话音色唱歌时，先用breeze_cover_sources查来源/音色，再用breeze_cover_create(engine=breeze)，不要用qq_song_cover或假称需要RVC模型。RVC也可用该工具(engine=rvc)。清唱必须arrangement=acappella，只含换声后人声；mixed才加伴奏。默认10秒本机试听，不自动发QQ；制作后用breeze_cover_status查询，不重复创建。只有主人明确要发送时用breeze_cover_send。实验换声可能跑调/改音高，不能承诺原曲保真。');
  return {...studio,send};
 }
};
