import {readFileSync,writeFileSync,existsSync,renameSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

const normal=x=>String(x||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const stem=x=>String(x||'').replace(/\.(?:mp3|wav|flac|m4a|aac|ogg|opus|mp4|webm)$/i,'');
const isImport=s=>s?.origin==='本机导入'&&/^i-[0-9a-f]{18}$/.test(String(s.id));
const clean=s=>String(s||'').trim();
function artistRemainderMatches(text,artists){
 const names=[...new Set(artists)].sort((a,b)=>b.length-a.length);let rest=text;const used=new Set();
 for(let i=0;i<=names.length;i++){
  rest=rest.replace(/^(?:的|和|与|及)+/,'');if(!rest)return used.size>0;
  const hit=names.find(a=>!used.has(a)&&rest.startsWith(a));if(!hit)return false;
  used.add(hit);rest=rest.slice(hit.length);
 }
 return false;
}

// Exact title/alias matching only: "雨" must not accidentally match "雨爱".
// Anonymous original-song caches are intentionally not eligible for auto-match.
export function matchLocalSources(query,sources,metadata={}){
 const raw=String(query||'').normalize('NFKC'),q=normal(raw),matches=[];if(!q)return matches;
 const tokens=raw.split(/[\s《》「」“”"'，,、:：;；|/—–-]+/).map(normal).filter(Boolean);
 for(const source of sources.filter(isImport)){
  const m=metadata[source.id]||{},title=clean(m.title)||stem(source.label),artists=clean(m.artists);
  const aliases=[title,stem(source.label),...(Array.isArray(m.aliases)?m.aliases:[])].map(normal).filter(Boolean);
  // Work credits aid song-name matching; they do NOT label the imported
  // recording's performer (which may be an edit/cover/uploader).
  const songArtists=Array.isArray(m.songArtists)?m.songArtists:[];
  const artistKeys=[...artists.split(/\s*\/\s*/),...songArtists].map(normal).filter(Boolean);
  let score=0,mode='';const consider=(n,m)=>{if(n>score){score=n;mode=m;}};
  for(const a of aliases){
   if(q===a){consider(3,'exact-title');continue;}
   if(!q.includes(a))continue;const rest=q.replace(a,'');
   if(artistRemainderMatches(rest,artistKeys)){consider(2,'known-credit');continue;}
   const restricted=/原唱|原版|官方|现场|伴奏|纯音乐|remix|live|指定|必须|只要|不要|别用|版本|版/i.test(rest);
   if(restricted){if(/版$/.test(rest)&&artistRemainderMatches(rest.replace(/版$/,''),artists.split(/\s*\/\s*/).map(normal).filter(Boolean))){consider(4,'explicit-performer');}continue;}
   if(a.length>=2&&(tokens.includes(a)||q.endsWith('的'+a))&&rest.length<=80){consider(1,'title-first');}
  }
  if(score)matches.push({id:source.id,sourceId:source.id,kind:'local',name:title,artists:artists||(songArtists.length?'本机导入（原曲歌手：'+songArtists.join(' / ')+'）':'本机导入'),label:source.label,matchScore:score,matchMode:mode,matchReason:mode==='title-first'?'本地按歌名匹配；歌手词仅作作品提示，不要求原唱本人':'已匹配本地登记歌名或明确版本'});
 }
 const best=Math.max(0,...matches.map(x=>x.matchScore));return matches.filter(x=>x.matchScore===best);
}

export function createLocalSources({root,getSources}){
 mkdirSync(root,{recursive:true});const file=join(root,'local-sources.json');let metadata={},loadError=null;
 if(existsSync(file)){
  try{const data=JSON.parse(readFileSync(file,'utf8'));
   if(data?.version!==1||!data.entries||typeof data.entries!=='object'||Array.isArray(data.entries))throw Error('invalid local catalog');
   metadata=data.entries;
  }catch{loadError=Error('本地原曲歌名索引无效，未自动改用网易云');}
 }
 const check=()=>{if(loadError)throw loadError;};
 function list(){check();return getSources().filter(isImport).map(s=>({...s,title:clean(metadata[s.id]?.title)||stem(s.label),artists:clean(metadata[s.id]?.artists),songArtists:Array.isArray(metadata[s.id]?.songArtists)?metadata[s.id].songArtists:[],aliases:Array.isArray(metadata[s.id]?.aliases)?metadata[s.id].aliases:[]}));}
 function set({sourceId,title,artists='',songArtists=[],aliases=[]}){
  check();
  if(!getSources().some(s=>isImport(s)&&s.id===sourceId))throw Error('该本地导入原曲不存在，请刷新列表');
  if(typeof title!=='string'||!title.trim()||title.length>120)throw Error('本地歌名须为1–120个字符');
  if(typeof artists!=='string'||artists.length>120||!Array.isArray(songArtists)||songArtists.length>8||songArtists.some(a=>typeof a!=='string'||!a.trim()||a.length>120)||!Array.isArray(aliases)||aliases.length>12||aliases.some(a=>typeof a!=='string'||!a.trim()||a.length>120))throw Error('本地歌手或别名格式无效');
  const entry={title:title.trim(),artists:artists.trim(),songArtists:[...new Set(songArtists.map(x=>x.trim()))],aliases:[...new Set(aliases.map(x=>x.trim()))]};
  const next={...metadata,[sourceId]:entry},tmp=file+'.'+randomUUID()+'.tmp';
  writeFileSync(tmp,JSON.stringify({version:1,entries:next},null,2));renameSync(tmp,file);metadata=next;
  return {ok:true,message:'本地原曲的点歌名称已保存；没有开始制作或发送',list:list()};
 }
 return {list,set,match:query=>{check();return matchLocalSources(query,getSources(),metadata);}};
}
