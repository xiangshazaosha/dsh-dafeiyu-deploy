import {readFileSync,writeFileSync,readdirSync,statSync,lstatSync,existsSync,realpathSync,mkdirSync,renameSync} from 'node:fs';
import {join,resolve,relative,isAbsolute,parse,basename,extname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
const hash=x=>createHash('sha256').update(x).digest('hex');
const audio=/\.(?:mp3|wav|flac|m4a|aac|ogg|opus|mp4|webm)$/i;
const inside=(root,path)=>{const r=relative(root,path);return !!r&&!r.startsWith('..')&&!isAbsolute(r);};
const samePath=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
export function guessSongName(filename){
 const stem=basename(filename,extname(filename)).replace(/^\s*\d{1,3}[_. -]+/,'').trim(),parts=stem.split(/_+/).filter(Boolean);
 return {title:(parts[0]||stem).slice(0,120),artists:parts.slice(1).join(' ').slice(0,120),aliases:[basename(filename,extname(filename)).slice(0,120)].filter(Boolean)};
}
export function createFolderLibrary({root,getSources,importAudio,localSources,now=Date.now}){
 mkdirSync(root,{recursive:true});const file=join(root,'source-folders.json'),imports=join(root,'imports'),observed=new Map(),digests=new Map();
 let data={version:1,enabled:true,folders:[],files:{}},error='',lastScanAt=0,lastResult=null,scanning=false,disposed=false;
 if(existsSync(file)){try{const x=JSON.parse(readFileSync(file,'utf8'));if(x.version!==1||typeof x.enabled!=='boolean'||!Array.isArray(x.folders)||!x.files||typeof x.files!=='object')throw Error('Invalid schema');data=x;}catch{error='自动入库目录配置损坏，未覆盖配置或扫描其它目录';}}
 function check(){if(error)throw Error(error);if(disposed)throw Error('自动入库模块已停止');}
 function save(){const tmp=file+'.'+randomUUID()+'.tmp';writeFileSync(tmp,JSON.stringify(data,null,2));renameSync(tmp,file);}
 function state(){return {ok:!error,enabled:data.enabled,folders:data.folders.map(f=>({id:f.id,path:f.path})),scanning,lastScanAt,lastResult,error,intervalSec:5};}
 function folderPath(value){if(typeof value!=='string'||!isAbsolute(value)||!existsSync(value)||!statSync(value).isDirectory())throw Error('请选择已存在的本地曲库文件夹');const p=realpathSync(value);if(samePath(p,parse(p).root))throw Error('不能监控整块磁盘，请选择具体歌曲文件夹');return p;}
 function add(path){check();const p=folderPath(path);if(!data.folders.some(f=>samePath(f.path,p))){if(data.folders.length>=8)throw Error('最多登记8个指定曲库目录');data.folders.push({id:hash(p).slice(0,16),path:p});save();}return state();}
 function remove(id){check();if(!data.folders.some(f=>f.id===id))throw Error('目录不存在');data.folders=data.folders.filter(f=>f.id!==id);save();return state();}
 function enabled(value){check();if(typeof value!=='boolean')throw Error('自动入库开关格式错误');data.enabled=value;save();return state();}
 function digest(path,stamp){const cached=digests.get(path);if(cached?.stamp===stamp)return cached.hash;const h=hash(readFileSync(path));digests.set(path,{stamp,hash:h});return h;}
 function scan({force=false}={}){
  check();if(scanning)return state();if(!data.enabled&&!force)return state();scanning=true;
  let imported=0,reused=0,waiting=0,skipped=0,bytesRead=0,changed=false;const errors=[];
  try{
   const sources=getSources().filter(s=>s.origin==='本机导入'),ids=new Set(sources.map(s=>s.id)),known=new Map();
   const knownByHash=()=>{
    if(known.size||!existsSync(imports))return;
    const rr=realpathSync(imports);
    for(const f of readdirSync(imports,{withFileTypes:true})){if(!f.isFile()||!audio.test(f.name))continue;const p=join(imports,f.name);if(lstatSync(p).isSymbolicLink()||!inside(rr,realpathSync(p)))continue;const s=statSync(p);if(s.size>64*1024*1024)continue;const id='i-'+hash(f.name).slice(0,18);if(ids.has(id))known.set(digest(p,s.size+':'+s.mtimeMs),id);}
   };
   for(const f of data.folders){
    let directory;try{directory=folderPath(f.path);}catch(e){errors.push(e.message);continue;}
    const entries=readdirSync(directory,{withFileTypes:true}).filter(e=>e.isFile()&&audio.test(e.name)).sort((a,b)=>a.name.localeCompare(b.name));
    if(entries.length>2000){errors.push('目录音频超过2000项，只处理前2000项，请拆分目录');}
    for(const entry of entries.slice(0,2000)){
     const path=join(directory,entry.name),key=f.id+'/'+entry.name;
     try{
      if(lstatSync(path).isSymbolicLink()||!inside(directory,realpathSync(path))){skipped++;continue;}
      const s=statSync(path),stamp=s.size+':'+s.mtimeMs,prior=data.files[key];if(!s.size||s.size>64*1024*1024){skipped++;continue;}
      if(prior?.stamp===stamp&&ids.has(prior.sourceId))continue;
      const observation=observed.get(key),stable=now()-s.mtimeMs>=3000||observation?.stamp===stamp&&now()-observation.at>=1500;
      if(!force&&!stable){observed.set(key,{stamp,at:observation?.stamp===stamp?observation.at:now()});waiting++;continue;}
      if(imported>=16||bytesRead+s.size>128*1024*1024){waiting++;continue;}
      const bytes=readFileSync(path),after=statSync(path);if(bytes.length!==s.size||after.size!==s.size||after.mtimeMs!==s.mtimeMs){observed.set(key,{stamp:after.size+':'+after.mtimeMs,at:now()});waiting++;continue;}
      bytesRead+=bytes.length;const h=hash(bytes);knownByHash();let sourceId=known.get(h);
      if(sourceId){reused++;}else{
       const beforeIds=new Set(getSources().map(s=>s.id)),result=importAudio(entry.name,bytes);if(result.ok===false)throw Error(result.message||'导入失败');const added=getSources().filter(s=>s.origin==='本机导入'&&!beforeIds.has(s.id));if(added.length!==1)throw Error('无法识别新导入条目');sourceId=added[0].id;ids.add(sourceId);known.set(h,sourceId);imported++;
       const guess=guessSongName(entry.name);localSources.set({sourceId,...guess});
      }
      data.files[key]={stamp,sha256:h,sourceId,importedAt:now()};changed=true;observed.delete(key);
     }catch(e){errors.push(entry.name+'：'+e.message);}
    }
   }
   if(changed)save();lastScanAt=now();lastResult={imported,reused,waiting,skipped,errors:errors.slice(0,8),tracked:Object.keys(data.files).length};scanning=false;return state();
  }finally{scanning=false;}
 }
 return {state,add,remove,enabled,scan,dispose:()=>{disposed=true;}};
}
