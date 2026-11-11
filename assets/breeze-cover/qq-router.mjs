import {readFileSync,writeFileSync,existsSync,renameSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';

export const NATIVE_GUARD=Symbol.for('dsh.cover.native.dispatch.v1');
const hash=x=>createHash('sha256').update(String(x)).digest('hex');
const normal=x=>String(x||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const pending=new Set(['resolving','queued','running','sending']);
export const SOURCE_SELECTION_REVISION='local-first-v6';
export const wantsFresh=text=>/重新制作|重新翻唱|重新唱|重唱|重做|另做一版|换个新音色|用新音色/.test(String(text||''));
export function explicitEngine(text){
 const t=String(text||''),b=/breeze(?:\s*cpp)?|breezecpp/i.test(t),r=/\brvc\b/i.test(t);
 if(b&&r)throw Error('请一次只指定一个翻唱引擎，没有开始制作');
 return b?'breeze':r?'rvc':null;
}
export function cleanQuery(text){
 let s=String(text||'').replace(/breeze(?:\s*cpp)?|breezecpp|\brvc\b/gi,' ').replace(/重新制作|重新翻唱|重新唱|重唱|重做|另做一版|换个新音色|用新音色/g,' ').replace(/清唱(?:版)?|无伴奏(?:版)?|带伴奏(?:版)?/g,' ').replace(/(?:用|从|走|在)?\s*(?:网易云|本地|本机)(?:导入)?(?:的)?/g,' ').trim();
 for(let n=0;n<4;n++)s=s.replace(/^(?:请|帮我|给我|我想听|想听|播放|放|来|唱|点歌)(?:一首|首|一下)?\s*/,'').trim();
 return s.replace(/^[《「]|[》」]$/g,'').replace(/\s+/g,' ').trim();
}
// Search order is the tie-breaker for equivalent studio entries, not proof of an
// "official" master. Never guess the original artist from search position alone.
const versionPatterns={
 live:/(?<![a-z])live(?![a-z])|现场(?:版)?|演唱会(?:版)?/i,
 remix:/(?<![a-z])(?:remix|rmx|dj)(?![a-z])|混音(?:版)?|串烧|加速(?:版)?|慢速(?:版)?|变速(?:版)?/i,
 cover:/(?<![a-z])cover(?![a-z])|翻唱(?:版)?|翻自/i,
 instrumental:/(?<![a-z])instrumental(?![a-z])|纯音乐(?:版)?|伴奏(?:版)?/i,
 alternate:/(?<![a-z])(?:demo|acoustic|unplugged)(?![a-z])|不插电(?:版)?|重录(?:版)?|试听版|片段/i
};
const variants=text=>Object.keys(versionPatterns).filter(k=>versionPatterns[k].test(text));
function queryIntent(query){
 let text=String(query||'').normalize('NFKC');const banned=[];
 for(const [key,pattern]of Object.entries(versionPatterns)){
  // A negated version preference must never become an explicit request for it.
  const neg=new RegExp('(?:不要|别选|不是|非|不选|排除)\\s*(?:'+pattern.source+')','gi');
  text=text.replace(neg,()=>{banned.push(key);return ' ';});
 }
 const wanted=variants(text);
 for(const pattern of Object.values(versionPatterns))text=text.replace(new RegExp(pattern.source,'gi'),' ');
 text=text.replace(/原唱|原版|官方(?:版)?|录音室(?:版)?|专辑版|普通版/g,' ');
 return {text,wanted,banned};
}
function songBase(name){
 let text=String(name||'').normalize('NFKC')
  .replace(/\(([^)]*)\)|【([^】]*)】|\[([^\]]*)\]/g,(full,...g)=>variants(g.slice(0,3).filter(Boolean).join(' ')).length?' ':full)
  .replace(/\s*[-–—·]?\s*(?:录音室版|专辑版|原版)\s*$/g,'');
 for(const pattern of Object.values(versionPatterns))text=text.replace(new RegExp(pattern.source,'gi'),' ');
 return text.replace(/\s*[-–—·]?\s*版\s*$/,'').trim();
}
export function rankCandidates(query,list){
 const intent=queryIntent(query),q=normal(intent.text),unique=new Map();
 for(const [index,item]of list.entries()){
  const identity=item.id==null?'row:'+index:'id:'+item.id;if(unique.has(identity))continue;
  const base=normal(songBase(item.name));if(!base||!q.includes(base))continue;
  const artists=String(item.artists||'').split(/\s*\/\s*/).map(normal).filter(Boolean);
  const remainder=q.replace(base,'');
  // A performer/account sharing the song title is not an artist instruction.
  const matchedArtists=artists.filter(a=>remainder.includes(a));
  const tags=variants([item.name,...(Array.isArray(item.alias)?item.alias:[item.alias||''])].join(' '));
  if(intent.banned.some(t=>tags.includes(t))||intent.wanted.some(t=>!tags.includes(t)))continue;
  // Unknown extra words may be an artist request that did not match. Do not
  // silently sing a different artist's work just because the title matches.
  let residual=remainder;for(const a of [...matchedArtists].sort((a,b)=>b.length-a.length))residual=residual.replace(a,'');
  for(const alias of (Array.isArray(item.alias)?item.alias:[item.alias||''])){if(/翻自|原唱|cover/i.test(alias)||!variants(alias).length&&!/版/.test(alias))continue;const known=normal(queryIntent(alias).text);if(known.length>=2)residual=residual.split(known).join('');}
  residual=residual.replace(/的|这首歌|歌曲|版本|版|一下|我要|我想听|想听|请|帮我|给我|唱|播放/g,'');
  if(residual)continue;
  const penalty=tags.reduce((n,t)=>n+(intent.wanted.includes(t)?0:({live:30,remix:50,cover:60,instrumental:80,alternate:10}[t])),0);
  unique.set(identity,{item,index,base,artistsKey:[...artists].sort().join('/'),artistMatch:matchedArtists.length>0,extraArtists:artists.length-matchedArtists.length,penalty,tags});
 }
 let pool=[...unique.values()];
 if(pool.some(x=>x.artistMatch)){
  pool=pool.filter(x=>x.artistMatch);
  // Exact requested solo credits outrank collaborations merely containing
  // the same singer. Asking for both singers still matches the duet only.
  const extra=Math.min(...pool.map(x=>x.extraArtists));pool=pool.filter(x=>x.extraArtists===extra);
 }
 else{
  // A separate cover's explicit "翻自/原唱" metadata can identify a likely
  // original artist among homonymous songs. It is a clue, not certification.
  const originClues=new Set();
  for(const source of list){
   const alias=Array.isArray(source.alias)?source.alias.join(' '):String(source.alias||'');
   for(const m of alias.matchAll(/(?:翻自|原唱)\s*[：:]?\s*([^;；，,|（）()]+)/g)){
    const ref=normal(m[1]);for(const row of pool){
     if(normal(songBase(source.name))===row.base&&row.artistsKey&&row.artistsKey!==String(source.artists||'').split(/\s*\/\s*/).map(normal).filter(Boolean).sort().join('/')&&row.artistsKey.split('/').some(a=>ref===a))originClues.add(row.artistsKey);
    }
   }
  }
  if(originClues.size===1)pool=pool.filter(x=>originClues.has(x.artistsKey));
 }
 const longest=Math.max(0,...pool.map(x=>x.base.length));pool=pool.filter(x=>x.base.length===longest);
 // Suppress tiny same-work excerpts only when a full-length track sharing
 // an artist is present. Do not dismiss unrelated short songs by duration.
 const full=pool.filter(x=>Number(x.item.durationSec)>=60);
 pool=pool.filter(x=>!(Number(x.item.durationSec)>0&&Number(x.item.durationSec)<45&&full.some(f=>f.artistsKey.split('/').some(a=>a&&x.artistsKey.split('/').includes(a)))));
 return pool.sort((a,b)=>a.penalty-b.penalty||a.index-b.index);
}
export function selectCandidate(query,list){
 const ranked=rankCandidates(query,list);if(!ranked.length)return null;
 const best=ranked.filter(x=>x.penalty===ranked[0].penalty);
 // Different artists with equally good versions remain genuinely ambiguous.
 if(best.length>1&&(!best[0].artistsKey||new Set(best.map(x=>x.artistsKey)).size!==1))return null;
 if(new Set(best.map(x=>x.base)).size!==1)return null;
 const pick=best[0];return {item:pick.item,reason:queryIntent(query).wanted.length?'按明确要求的歌曲版本选择':pick.penalty===0?'优先普通录音室版本（有原唱关联标注时优先参考）；同歌手重复条目按搜索顺序去重':'未找到普通版，按版本优先级选择',rule:'studio-first-v2'};
}
export function chooseCandidate(query,list){return selectCandidate(query,list)?.item||null;}
export function looksNonVocal(item){return /伴奏|纯音乐|instrumental|钢琴|piano|type\s*beat|(?:^|[^a-z])beats?(?:$|[^a-z])/i.test([item.name,item.artists,...(Array.isArray(item.alias)?item.alias:[item.alias||''])].join(' '));}
export function rankAlternativeSources(query,list){
 const raw=String(query||'').normalize('NFKC'),intent=queryIntent(raw),q=normal(intent.text),tokens=intent.text.split(/[\s《》「」“”"'，,、:：;；|/—–]+/).map(normal).filter(Boolean),rows=[];
 for(const [index,item]of list.entries()){
  if(looksNonVocal(item))continue;const title=songBase(item.name),base=normal(title);if(!base||!q.includes(base))continue;
  const plain=intent.text.trim().toLowerCase(),t=title.trim().toLowerCase(),boundary=tokens.includes(base)||plain===t||plain.startsWith(t+' ')||plain.endsWith(' '+t)||q.endsWith('的'+base);if(!boundary)continue;
  let rest=raw.replace(title,'');rest=rest.replace(/(?:不必|不用|不要|不要求|无需|不限|没有|找不到)\s*(?:一定)?(?:是|要|用)?\s*(?:原唱|原版|本人)/g,'');
  for(const pattern of Object.values(versionPatterns))rest=rest.replace(new RegExp('(?:不要|别选|不是|非|不选|排除)\\s*(?:'+pattern.source+')','gi'),' ');
  if(/原唱|原版|官方|本人|必须|指定|只要|不要.*(?:翻唱|其他|其它)|版本|版|live|remix|dj/i.test(rest))continue;
  const tags=variants([item.name,...(Array.isArray(item.alias)?item.alias:[item.alias||''])].join(' '));if(intent.wanted.some(t=>!tags.includes(t))||intent.banned.some(t=>tags.includes(t)))continue;
  const aliases=Array.isArray(item.alias)?item.alias:[item.alias||''];let workEvidence=false;
  for(const alias of aliases)for(const m of alias.matchAll(/(?:翻自|原唱)\s*[：:]?\s*([^;；，,|（）()]+)/g)){const ref=normal(m[1]);if(ref.length>=2&&q.includes(ref))workEvidence=true;}
  const duration=Number(item.durationSec),penalty=tags.reduce((n,t)=>n+({live:40,remix:60,cover:10,instrumental:999,alternate:20}[t]||0),0)+(duration>0&&duration<60?30:0)-(workEvidence?25:0);
  rows.push({item,index,base,penalty});
 }
 const longest=Math.max(0,...rows.map(x=>x.base.length));return rows.filter(x=>x.base.length===longest).sort((a,b)=>a.penalty-b.penalty||a.index-b.index);
}
export async function chooseOnlineSource(query,list,canUseSong){
 const ranked=rankCandidates(query,list).filter(x=>{if(looksNonVocal(x.item))return false;const rest=String(query).replace(songBase(x.item.name),'').replace(/(?:不必|不用|不要求|无需)\s*(?:是|用)?\s*(?:原唱|原版|本人)/g,'');return !/原唱|原版|本人/.test(rest)||x.artistMatch;}),primary=selectCandidate(query,ranked.map(x=>x.item)),tried=new Set();let probes=0;
 const bareTitle=ranked.some(x=>normal(queryIntent(query).text)===x.base);
 const usable=async item=>{if(tried.has(String(item.id)))return false;tried.add(String(item.id));probes++;return typeof canUseSong==='function'?!!(await canUseSong(String(item.id))):true;};
 if(primary&&await usable(primary.item))return {choice:primary,ranked,probes,alternate:false};
 // Ordinary title-only requests choose a playable ordinary recording rather
 // than asking a quiz about every cover artist. Explicit version ambiguities
 // remain choices; an artist hint may relax if no usable original was found.
 if(!ranked.length||primary||bareTitle){for(const row of rankAlternativeSources(query,list)){
  if(probes>=6)break;if(await usable(row.item))return {choice:{item:row.item,rule:'original-preferred-cover-allowed-v1',reason:bareTitle?'未指定演唱版本，自动选择可用的同名普通演唱来源；未将其认证为原唱，最终按选定音色换声':'原唱未找到或完整音频不可用，自动采用同名普通演唱来源（不是原唱本人）；最终按选定音色换声'},ranked,probes,alternate:true};
 }}
 return {choice:null,ranked,probes,alternate:false,unavailable:!!primary||!ranked.length||probes>0};
}
export function sourcePreference(text){
 const t=String(text||''),local=/本地|本机/.test(t),remote=/网易云/.test(t);
 if(local&&remote)throw Error('请一次只指定本地或网易云来源，未开始制作');
 return remote?'netease':local?'local':'auto';
}

export function createQQRouter({root,getConfig,studio,localSources,refreshLocal,getLegacyMatch,getLibrarySource,dispatchRequest,canUseSong,sendText,sendVoice,log={},now=Date.now}){
 mkdirSync(root,{recursive:true});const file=join(root,'qq-requests.json'),records=new Map();let disposed=false,ticking=false,guardInstalled=false,migrated=false;
 if(existsSync(file)){
  for(const r of JSON.parse(readFileSync(file,'utf8')).slice(0,30)){
   if(pending.has(r.status)){r.status='interrupted';r.message='模块重载，旧请求不会自动重做或重发';}
   if(['needs_choice','source_unavailable'].includes(r.status)&&r.selectionRevision!==SOURCE_SELECTION_REVISION){r.status='superseded';r.message='旧规则下的未制作记录；当前规则已更新，可按当前声音设置重试。没有自动重做或发送。';r.supersededAt=now();migrated=true;}
   records.set(r.id,r);
  }
 }
 function persist(){const tmp=file+'.'+randomUUID()+'.tmp';writeFileSync(tmp,JSON.stringify([...records.values()].sort((a,b)=>b.createdAt-a.createdAt).slice(0,30),null,2));renameSync(tmp,file);}
 if(migrated)persist();
 const active=()=>[...records.values()].some(r=>pending.has(r.status));
 const ownerStamp=()=>hash(getConfig().ownerQQ);
 function resolveEngine(text='',engine){const x=explicitEngine(text);if(engine&&!['breeze','rvc'].includes(engine))throw Error('翻唱引擎无效');if(x&&engine&&x!==engine)throw Error('歌曲要求与引擎参数冲突，没有开始制作');return engine||x||studio.state().engine||'rvc';}
 function publicRecord(r){return Object.fromEntries(Object.entries(r).filter(([k])=>!['ownerStamp','key'].includes(k)));}
 function status(){return {guardInstalled,selectionRevision:SOURCE_SELECTION_REVISION,active:active(),requests:[...records.values()].sort((a,b)=>b.createdAt-a.createdAt).slice(0,12).map(publicRecord)};}
 async function notify(r,text){try{if(!disposed&&ownerStamp()===r.ownerStamp&&getConfig().enabled&&!getConfig().dryRun)await sendText('private:'+getConfig().ownerQQ,text);}catch{log.warn?.('翻唱请求状态通知未送达；未重新制作或自动重发');}}
 function fail(r,error){r.status='failed';r.message=String(error.message||error).slice(0,400);r.finishedAt=now();persist();void notify(r,'翻唱没有完成：'+r.message+'。未改用另一引擎或旧成品。');}
 function startRecord(r,source){
  if(disposed)throw Error('翻唱模块已停用');
  const c=getConfig();if(!c.enabled||!c.song?.enabled||c.dryRun||ownerStamp()!==r.ownerStamp)throw Error('开关、试运行或主人身份已变更，没有开始制作');
  const result=studio.start({...r.spec,...source});r.jobId=result.job.id;r.status='queued';r.title=source.title||r.query;r.reusedFinished=!!result.reused;r.message=(result.reused?'命中对应参数的已翻唱成品，无需重新制作；':'已按 ')+r.engine.toUpperCase()+' / '+r.voiceName+' / '+(r.arrangement==='acappella'?'清唱':'带伴奏')+' / '+r.spec.durationSec+' 秒；完成后仅发送该版本';persist();
 }
 async function resolve(r,args){
  try{
   if(args.file){startRecord(r,{file:args.file,title:r.query});return;}
   if(args.songId){startRecord(r,{songId:String(args.songId),title:r.query});return;}
   if(r.sourcePreference!=='netease'){
    const local=localSources?.match(r.query)||[];
    if(local.length===1){const match=local[0];r.sourceSelection={mode:'auto',origin:'local',reason:(match.matchReason||'已导入本地原曲优先')+'；未搜索网易云',sourceId:match.sourceId,name:match.name,artists:match.artists,label:match.label};startRecord(r,{sourceId:match.sourceId,title:match.name+' · 本地原曲'});return;}
    if(local.length>1){
     r.status='needs_choice';r.candidates=local.slice(0,5);r.message='本地有多个同名原曲，请确认版本；未搜索网易云、未制作';persist();
     await notify(r,'本地找到多个「'+r.query+'」版本，暂未制作：\n'+r.candidates.map((x,i)=>(i+1)+'. '+x.label).join('\n')+'\n可到「系统→翻唱制作」点击选择，也可回复 /coverpick '+r.id.slice(0,8)+' 1。');return;
    }
    if(r.sourcePreference==='local')throw Error('没有找到匹配的本地导入原曲，请用已登记歌名或在面板选择；未改搜网易云');
   }
   if(r.spec.reuseFinished!==false&&studio.findFinished){
    for(const old of [...records.values()].sort((a,b)=>(b.finishedAt||b.createdAt)-(a.finishedAt||a.createdAt))){
     if(old.id===r.id||!old.jobId||normal(old.query)!==normal(r.query)||!['netease','library-source'].includes(old.sourceSelection?.origin)||!old.sourceSelection.songId)continue;
     const source={songId:old.sourceSelection.songId,title:old.title||old.query};
     if(studio.findFinished({...r.spec,...source})){r.sourceSelection={...old.sourceSelection,mode:'auto',reason:'命中当前引擎、音色和片段的已翻唱成品索引，未搜索网易云'};startRecord(r,source);return;}
    }
   }
   const hint=getLibrarySource?.(r.query);
   if(hint?.kind==='source'){
    if(!/^\d{1,20}$/.test(String(hint.songId)))throw Error('库中记录的原曲ID无效，没有使用旧换声文件代替');
    r.sourceSelection={mode:'auto',origin:'library-source',reason:'从已翻唱索引找回原曲ID；不播放旧声音，音色、片段起点和时长按本次请求处理',songId:String(hint.songId),name:hint.name,artists:hint.artists,version:hint.version};
    startRecord(r,{songId:String(hint.songId),title:[hint.name,hint.artists].filter(Boolean).join(' · ')});return;
   }
   if(hint?.kind==='ambiguous'){
    r.status='needs_choice';r.candidates=hint.candidates.slice(0,5).map(x=>({...x,kind:'library-source'}));r.message='已做歌曲索引中有多个符合版本的原曲ID，请确认来源；未制作';persist();await notify(r,r.message+'。可到「系统→翻唱制作」点击具体版本。');return;
   }
   const response=await studio.search(r.query);if(disposed)return;
   const list=(response.list||[]).filter(x=>/^\d{1,20}$/.test(String(x.id))).slice(0,30).map(x=>({id:String(x.id),name:String(x.name),artists:String(x.artists||''),alias:Array.isArray(x.alias)?x.alias:String(x.alias||''),durationSec:x.durationSec}));
   if(!list.length)throw Error('没有找到歌曲来源，请明确歌名和歌手');
   const selected=await chooseOnlineSource(r.query,list,canUseSong);if(disposed)return;const choice=selected.choice;
   if(choice){const match=choice.item;r.sourceSelection={mode:'auto',origin:'netease',rule:choice.rule,reason:choice.reason,songId:match.id,name:match.name,artists:match.artists};startRecord(r,{songId:match.id,title:match.name+' · '+match.artists});return;}
   const ranked=selected.ranked;
   if(selected.unavailable){
    r.status='source_unavailable';r.finishedAt=now();r.candidates=[];r.message=selected.probes?'找到相关来源，但没有取得可用的完整音频；未制作、未发送':'没有找到可用的同名演唱来源，或没有符合明确版本要求的来源；未制作、未发送';r.searchEvidence={query:r.query,returned:list.length,matched:ranked.length,probed:selected.probes};persist();
    await notify(r,r.message+'。可导入你有权使用的音频；如果明确指定了版本，请核对该版本是否存在或可取得完整音频。本次没有开始制作，不需要输入选歌命令。');return;
   }
   r.status='needs_choice';r.candidates=ranked.slice(0,5).map(x=>x.item);r.message='有多个符合条件的歌曲版本，请选来源；未制作、未发送';persist();
   await notify(r,'已锁定 '+r.engine.toUpperCase()+' / '+r.voiceName+' / '+(r.arrangement==='acappella'?'清唱':'带伴奏')+'。已优先普通版，但仍无法确定歌手或目标版本：\n'+r.candidates.map((x,i)=>(i+1)+'. '+x.name+' — '+x.artists).join('\n')+'\n可到「系统→翻唱制作」点击选歌；也可回复 /coverpick '+r.id.slice(0,8)+' 1（最后数字换成序号）。正常同歌手的重复版本会自动选择，不需要命令。');
  }catch(error){if(!disposed)fail(r,error);}
 }
 function hasUnifiedFinished(args={}){
  const s=studio.state();if(resolveEngine(args.song,args.engine)!=='rvc'||s.reuseFinished===false||wantsFresh(args.song)||!studio.findFinished||!s.rvcReady||active()||s.busy)return false;
  const query=cleanQuery(args.song||args.title||''),preference=sourcePreference(args.song||args.title||'');
  const local=preference==='netease'?[]:(localSources?.match(query)||[]);
  const sources=args.file?[{file:args.file}]:args.songId?[{songId:args.songId,title:query}]:local.length===1?[{sourceId:local[0].sourceId}]:local.length>1||preference==='local'?[]:[...records.values()].filter(r=>normal(r.query)===normal(query)&&['netease','library-source'].includes(r.sourceSelection?.origin)).map(r=>({songId:r.sourceSelection.songId,title:r.title||r.query}));
  const spec={engine:'rvc',voice:args.voice||s.rvcVoice,pitch:Number(args.pitch??s.rvcPitch??0),keepMelody:0,arrangement:args.arrangement||(/清唱|无伴奏/.test(args.song||'')?'acappella':/带伴奏/.test(args.song||'')?'mixed':s.rvcArrangement),startSec:Number(args.startSec??0),durationSec:Number(args.durationSec??s.qqDurationSec??10),lyrics:String(args.lyrics||''),reuseFinished:true};
  return sources.some(source=>!!studio.findFinished({...spec,...source}));
 }
 function intercept(args={}){
  const c=getConfig(),isOwner=args.chatId==='private:'+c.ownerQQ;let engine;
  try{engine=resolveEngine(args.song,args.engine);}catch(error){return {handled:true,result:{ok:false,message:error.message}};}
  if(!isOwner){
   if(args.engine==='breeze'||explicitEngine(args.song)==='breeze')return {handled:true,result:{ok:false,message:'Breeze QQ翻唱目前仅支持主人私聊，没有改用RVC'}};
   if(studio.state().busy||active())return {handled:true,result:{ok:false,message:'已有翻唱任务正在处理，请完成后再制作'}};
   return {handled:false,args};
  }
  if(!c.enabled||!c.song?.enabled)return {handled:true,result:{ok:false,message:'翻唱功能关闭，未开始制作'}};
  if(c.dryRun)return {handled:true,result:{ok:true,queued:false,sent:false,message:'当前试运行，没有开始制作或发送'}};
  try{if(sourcePreference(args.song||args.title||'')!=='netease')refreshLocal?.();}catch(error){return {handled:true,result:{ok:false,message:'本地原曲库同步失败，未改搜网易云：'+error.message}};}
  const reuseFinished=studio.state().reuseFinished!==false&&!wantsFresh(args.song)&&args.reuseFinished!==false;
  let unifiedRVCHit=false;
  if(engine==='rvc'&&reuseFinished&&studio.findFinished&&studio.state().rvcReady&&!active()&&!studio.state().busy){
   try{unifiedRVCHit=hasUnifiedFinished(args);}catch(error){return {handled:true,result:{ok:false,message:'读取统一成品索引失败，没有播放其他旧成品：'+error.message}};}
  }
  let routeLocalRVC=false;
  if(engine==='rvc'&&reuseFinished&&!args.file&&!args.songId){try{const q=cleanQuery(args.song||''),local=sourcePreference(args.song||'')!=='netease'&&(localSources?.match(q)||[]).length,hint=getLibrarySource?.(q);if(local||hint?.kind==='source'||hint?.kind==='ambiguous'){const legacy=getLegacyMatch?.(args.song||'');routeLocalRVC=!['match','needs-acappella'].includes(legacy?.kind);}}catch(error){return {handled:true,result:{ok:false,message:'核对本地原曲/成品索引失败，未改搜网易云：'+error.message}};}}
  if(engine==='rvc'&&reuseFinished&&!unifiedRVCHit&&!routeLocalRVC){
   if(studio.state().busy||active())return {handled:true,result:{ok:false,message:'Breeze/本机翻唱已有任务，未另开RVC制作'}};
   return {handled:false,args:{...args,song:String(args.song||'').replace(/\brvc\b/gi,'').trim()}};
  }
  try{
   const state=studio.state(),label=engine==='breeze'?'Breeze CPP':'RVC';if(!(engine==='breeze'?state.ready:state.rvcReady))throw Error(engine==='breeze'?'Breeze CPP未就绪，不会自动改用RVC':'RVC未就绪，不会自动改用Breeze');
   if(/整首|完整版|全曲/.test(String(args.song||'')))throw Error(label+'统一制作目前只支持1–180秒片段；请先指定片段长度，不会把短片段冒充整首');
   const voice=args.voice||(engine==='breeze'?state.selectedVoice:state.rvcVoice),v=(engine==='breeze'?state.voices:state.rvcVoices).find(x=>x.id===voice);if(!v)throw Error('所指定音色不属于当前'+label+'引擎，不会使用其他声音代替');
   const arrangement=args.arrangement||(/清唱|无伴奏/.test(args.song||'')?'acappella':/带伴奏/.test(args.song||'')?'mixed':engine==='breeze'?state.breezeArrangement:state.rvcArrangement);
   if(!['mixed','acappella'].includes(arrangement))throw Error('请指定清唱或带伴奏');
   const durationSec=Number(args.durationSec??state.qqDurationSec??10);if(!Number.isFinite(durationSec)||durationSec<1||durationSec>180)throw Error('片段时长须为1–180秒');
   const preference=sourcePreference(args.song||args.title||'');
   const query=cleanQuery(args.song||args.title||'');if(!query&&!args.songId&&!args.file)throw Error('请指定歌名、已确认歌曲ID或已导入音频');
   const spec={engine,voice,arrangement,startSec:Number(args.startSec??0),durationSec,keepMelody:engine==='breeze'?state.keepMelody:0,lyrics:String(args.lyrics||''),reuseFinished,...(engine==='rvc'?{pitch:Number(args.pitch??state.rvcPitch??0)}:{})};
   const key=hash(JSON.stringify({query,sourcePreference:preference,songId:args.songId,file:args.file,...spec}));
   let old=[...records.values()].find(r=>r.key===key&&(pending.has(r.status)||r.status==='needs_choice'||['sent','failed','delivery_uncertain','source_unavailable'].includes(r.status)&&now()-r.finishedAt<120000&&!(/重播|再发|再听|重听|重试/.test(args.song||'')||wantsFresh(args.song))));
   if(old&&['needs_choice','source_unavailable'].includes(old.status)&&preference!=='netease'){
    const currentLocal=localSources?.match(query)||[],sameLocalChoices=old.status==='needs_choice'&&old.candidates?.length===currentLocal.length&&old.candidates.every(x=>x.kind==='local'&&currentLocal.some(y=>y.sourceId===x.sourceId));
    if(currentLocal.length&&!sameLocalChoices){old.status='superseded';old.message='本地原曲索引已补齐，旧的网搜候选不再拦住新点歌';old.supersededAt=now();persist();old=null;}
   }
   if(old)return {handled:true,result:{ok:!['failed','delivery_uncertain','source_unavailable'].includes(old.status),queued:pending.has(old.status),reused:true,requestId:old.id,engine:old.engine,voice:old.voice,message:old.status==='sent'?'相同版本已提交发送，未重复制作或发送':old.message}};
   if(active()||state.busy)throw Error('已有翻唱任务正在处理，请先完成或取消；不会同时再跑另一套引擎');
   const r={id:randomUUID(),key,ownerStamp:ownerStamp(),engine,voice,voiceName:v.name||voice,arrangement,spec,sourcePreference:preference,selectionRevision:SOURCE_SELECTION_REVISION,query:query||String(args.songId||'本机音频'),createdAt:now(),status:'resolving',message:'正在确认歌曲来源（默认本地导入优先）；已锁定'+label+' / '+(v.name||voice)+' / '+(arrangement==='acappella'?'清唱':'带伴奏')+'；'+(reuseFinished?'优先符合当前参数的成品':'重新换声，不播放旧成品')};
   records.set(r.id,r);persist();void resolve(r,args);
   return {handled:true,result:{ok:true,queued:true,requestId:r.id,engine,voice,arrangement,message:r.message+'。默认 '+durationSec+' 秒试听，禁止另开其他引擎重复制作。'}};
  }catch(error){return {handled:true,result:{ok:false,engine,message:error.message}};}
 }
 function choose(id,index){
  const matches=[...records.values()].filter(r=>r.id===id||r.id.startsWith(String(id)));
  if(matches.length!==1)throw Error('请求ID不存在或不唯一');const r=matches[0];if(r.status!=='needs_choice')throw Error('该请求不在等待选歌，未重复制作');
  if(active()||studio.state().busy)throw Error('已有任务正在处理，请稍后选择');
  const item=r.candidates?.[Number(index)-1];if(!Number.isInteger(Number(index))||!item)throw Error('请选择列表中的歌曲序号');
  const isLocal=item.kind==='local';
  r.sourceSelection={mode:'manual',origin:isLocal?'local':item.kind==='library-source'?'library-source':'netease',...(isLocal?{sourceId:item.sourceId,label:item.label}:{songId:item.id}),name:item.name,artists:item.artists};startRecord(r,isLocal?{sourceId:item.sourceId,title:item.name+' · 本地原曲'}:{songId:item.id,title:[item.name,item.artists,item.version].filter(Boolean).join(' · ')});return {ok:true,request:publicRecord(r),message:r.message};
 }
 function resume(id){
  const matches=[...records.values()].filter(r=>r.id===id||r.id.startsWith(String(id)));
  if(matches.length!==1)throw Error('请求ID不存在或不唯一');const r=matches[0];
  if(r.status!=='superseded'||r.jobId)throw Error('仅可继续规则修复后失效、且从未开始制作的点歌；未重复制作或发送');
  if(disposed||active()||studio.state().busy)throw Error('模块已停用或已有翻唱任务，未重复开始');
  const cfg=getConfig(),s=studio.state();
  if(!cfg.enabled||!cfg.song?.enabled||cfg.dryRun||ownerStamp()!==r.ownerStamp)throw Error('开关或主人身份已改变，没有继续旧点歌');
  const matching=r.engine==='breeze'?s.ready&&s.selectedVoice===r.voice&&s.breezeArrangement===r.arrangement&&s.keepMelody===r.spec.keepMelody&&s.voices.some(v=>v.id===r.voice):r.engine==='rvc'&&s.rvcReady&&s.rvcVoice===r.voice&&s.rvcArrangement===r.arrangement&&Number(s.rvcPitch||0)===Number(r.spec.pitch||0)&&s.rvcVoices.some(v=>v.id===r.voice);
  if(s.engine!==r.engine||!matching||r.spec.reuseFinished!==undefined&&(s.reuseFinished!==false)!==r.spec.reuseFinished)throw Error('原点歌与当前声音设置不一致，请重新点歌确认');
  r.status='resolving';r.selectionRevision=SOURCE_SELECTION_REVISION;r.resumedAt=now();r.message='主人要求继续原点歌，正在按修复后的规则优先匹配本地原曲';delete r.candidates;persist();void resolve(r,{});
  return {ok:true,request:publicRecord(r),message:r.message};
 }
 function retry(id){
  const r=records.get(String(id));if(!r||!['superseded','source_unavailable','failed'].includes(r.status))throw Error('仅可重新发起未完成的点歌，已提交或发送不确定的任务不能在这里重发');
  if(disposed||active()||studio.state().busy||!guardInstalled)throw Error('正在处理任务或统一路由未就绪，没有重复点歌');
  const c=getConfig();if(ownerStamp()!==r.ownerStamp)throw Error('原请求不属于当前主人');if(typeof dispatchRequest!=='function')throw Error('重新点歌入口不可用');
  const prefix=r.sourcePreference==='netease'?'用网易云唱 ':r.sourcePreference==='local'?'用本地唱 ':'';
  return dispatchRequest({song:prefix+r.query,chatId:'private:'+c.ownerQQ});
 }
 async function tick(){
  if(disposed||ticking)return;ticking=true;
  try{for(const r of records.values()){
   if(!['queued','running'].includes(r.status))continue;
   let job;try{job=studio.status(r.jobId).job;}catch(error){fail(r,error);continue;}
   if(['failed','cancelled','interrupted'].includes(job.status)){fail(r,job.error||job.stage);continue;}
   if(job.status!=='done'){r.status='running';continue;}
   if(job.engine!==r.engine||job.voice!==r.voice){fail(r,'实际任务引擎或音色与请求不符，已阻止发送');continue;}
   const c=getConfig();if(!c.enabled||!c.song?.enabled||c.dryRun||ownerStamp()!==r.ownerStamp){fail(r,'发送前开关或主人身份已变更，已阻止发送');continue;}
   r.status='sending';r.message='正在提交 '+r.engine.toUpperCase()+' / '+r.voiceName+' / '+(r.arrangement==='acappella'?'清唱':'带伴奏');persist();
   try{
    const audio=studio.resultFile(r.jobId,r.arrangement);
    const label=r.engine==='breeze'?'Breeze CPP':'RVC';await sendVoice('private:'+c.ownerQQ,audio,'[翻唱成品·'+label+'·'+r.voiceName+'·'+(r.arrangement==='acappella'?'清唱':'带伴奏')+'·'+Math.round(job.seconds||r.spec.durationSec)+'秒·'+r.jobId.slice(0,8)+'] '+(r.title||r.query));
    r.status='sent';r.finishedAt=now();r.message='已提交QQ：'+label+' / '+r.voiceName+' / '+(r.arrangement==='acappella'?'清唱':'带伴奏')+'；收件播放未确认';r.actualEngine=job.engine;r.actualVoice=job.voice;
   }catch(error){r.status='delivery_uncertain';r.finishedAt=now();r.message='发送失败或结果未确认；不会自动重发或改用RVC：'+String(error.message||error).slice(0,200);}
   persist();
  }}finally{ticking=false;}
 }
 return {resolveEngine,intercept,choose,resume,retry,hasUnifiedFinished,tick,status,active,setGuard:v=>{guardInstalled=!!v;},dispose:()=>{disposed=true;for(const r of records.values())if(pending.has(r.status)){r.status='interrupted';r.message='模块重载，未自动重做或重发';}persist();}};
}

export function installNativeGuard(api,router){
 let mounted=null,disposed=false;
 function restore(){if(mounted&&mounted.song.request===mounted.wrapper)mounted.song.request=mounted.cell.inner;mounted=null;router.setGuard(false);}
 function ensure(){
  if(disposed)return;const song=api.use('song');if(!song||typeof song.request!=='function')return;
  if(mounted?.song===song&&song.request===mounted.wrapper){router.setGuard(true);return;}
  restore();if(song.request[NATIVE_GUARD]){api.log.warn?.('已有其他翻唱路由占用；没有叠加第二个路由');return;}
  const cell={inner:song.request};
  const wrapper=function(args={}){const result=router.intercept(args);return result.handled?result.result:cell.inner.call(song,result.args||args);};
  Object.defineProperty(wrapper,NATIVE_GUARD,{value:cell});song.request=wrapper;mounted={song,cell,wrapper};router.setGuard(true);
 }
 ensure();api.on('module/start',id=>{if(id==='song'||id==='song-library')ensure();});api.every(1000,ensure,'保持QQ翻唱引擎路由');
 api.onDispose(()=>{disposed=true;restore();});return {ensure};
}
