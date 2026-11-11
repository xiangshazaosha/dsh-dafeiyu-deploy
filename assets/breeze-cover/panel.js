const {useState,useEffect}=React;
const BASE='/aurabot/api/ext/breeze-cover';
return function CoverWorkbench({toast}){
 const [data,setData]=useState(null),[source,setSource]=useState(''),[kind,setKind]=useState('local'),[query,setQuery]=useState(''),[found,setFound]=useState([]),[songId,setSongId]=useState(''),[start,setStart]=useState('0'),[seconds,setSeconds]=useState('10'),[lyrics,setLyrics]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(''),[folderPath,setFolderPath]=useState(''),[titleDraft,setTitleDraft]=useState({});
 const load=async(initial=false)=>{try{const r=await call('/state');if(!r.ok)throw Error(r.message||'读不到当前设置');setData(r);if(initial)setSource(r.sources[0]?.id||'');setError('');}catch(e){setError(e.message||String(e));}};
 useEffect(()=>{load(true);const t=setInterval(()=>load(),2000);return()=>clearInterval(t);},[]);
 const act=async(label,fn)=>{setBusy(label);setError('');try{const r=await fn();if(r.ok===false)throw Error(r.message||'操作失败');toast(r.message||'已完成','ok');await load();return r;}catch(e){setError(e.message||String(e));toast(e.message||String(e),'err');}finally{setBusy('');}};
 const importFile=async file=>{if(!file)return;if(file.size>64*1024*1024)return setError('文件最大64MB');const ids=new Set(data?.sources.map(x=>x.id)||[]);await act('导入歌曲',async()=>{const r=await fetch(BASE+'/import?name='+encodeURIComponent(file.name),{method:'POST',body:file});const s=await r.json();if(s.ok){const fresh=s.sources?.find(x=>!ids.has(x.id));if(fresh)setSource(fresh.id);}return s;});};
 const chooseFile=()=>{const el=document.createElement('input');el.type='file';el.accept='.mp3,.wav,.flac,.m4a,.aac,.ogg,.opus,.mp4,.webm';el.onchange=()=>importFile(el.files?.[0]);el.click();};
 if(!data)return h(ui.Card,{title:'翻唱制作'},h('p',null,error||'正在读取…'),h(ui.Btn,{onClick:()=>load(true)},'重新读取'));
 const p=data.profile,sourceValid=kind==='local'?data.sources.some(x=>x.id===source):found.some(x=>String(x.id)===songId),song=(data.localSongs||[]).find(x=>x.id===source),folders=data.folderLibrary;
 return h(React.Fragment,null,
  h('div',{className:'ab-note',style:{gridColumn:'1 / -1'}},'这里只负责选歌、制作和试听。引擎、音色、清唱/伴奏和保留旋律统一在上方「音色切换」设置；本页不再保存第二套声音参数。'),
  error?h('div',{className:'ab-note err',role:'alert',style:{gridColumn:'1 / -1'}},error):null,
  h('div',{style:{gridColumn:'1 / -1'}},h(ui.Card,{title:'① 当前声音设置 · 只读',desc:'与主人QQ点歌共用。想改声音，请点击上方「音色切换」。'},
   h('p',{className:'ab-small'},data.reuseFinished===false?'成品策略：重新换声（不播放旧成品，保留分离缓存）':'成品策略：优先复用符合当前引擎、音色和片段的已翻唱成品'),
   p?h('div',{className:'ab-note',style:{borderLeft:'4px solid var(--ab-primary, #3678c8)'}},h('strong',null,p.engineName+' / '+p.voiceName+' / '+p.arrangementName),h('p',{className:'ab-small',style:{marginBottom:0}},p.engine==='breeze'?'保留旋律：'+p.keepMelody+'；CPU分离 → Breeze CPP换声':'RVC默认变调：'+p.pitch+'半音；CPU分离与换声')):h('p',{className:'ab-note err'},'统一声音设置未就绪，请重新读取。'),
   p&&!p.ready?h('p',{className:'ab-note warn'},'当前引擎或音色不可用，不会自动切换到其他声音。'):null,
   h(ui.Btn,{small:true,disabled:!!busy,onClick:()=>load()},'重新读取统一设置'))),
  folders?h('div',{style:{gridColumn:'1 / -1'}},h(ui.Card,{title:'本地原曲库 · 自动入库',desc:'只监控你登记的目录。新音频自动进入原曲列表，不会自动翻唱、换音色或发QQ。'},
   h('div',{style:{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}},h('input',{className:'ab-input',style:{flex:'1 1 380px'},value:folderPath||'',onChange:e=>setFolderPath(e.target.value),placeholder:'粘贴本地歌曲文件夹的完整路径','aria-label':'自动入库文件夹'}),h(ui.Btn,{disabled:!!busy||!String(folderPath||'').trim(),onClick:()=>act('添加曲库目录',()=>call('/folders',{action:'add',path:String(folderPath||'').trim()}))},'添加目录并扫描')),
   h('div',{style:{display:'flex',gap:8,flexWrap:'wrap',marginTop:10}},h('button',{type:'button',role:'switch','aria-checked':!!folders.enabled,className:'ab-btn',disabled:!!busy,onClick:()=>act('切换自动入库',()=>call('/folders',{action:'enabled',enabled:!folders.enabled}))},folders.enabled?'自动入库：开':'自动入库：关'),h(ui.Btn,{disabled:!!busy,onClick:()=>act('扫描本地曲库',()=>call('/folders',{action:'scan'}))},'立即扫描')),
   !(folders.folders||[]).length?h('p',{className:'ab-small ab-muted'},'尚未登记文件夹。也可以在下面只导入单个文件。'):(folders.folders||[]).map(f=>h('div',{key:f.id,className:'ab-note',style:{display:'flex',gap:10,alignItems:'center',justifyContent:'space-between',marginTop:8}},h('span',{style:{overflowWrap:'anywhere'}},f.path),h(ui.Btn,{small:true,disabled:!!busy,onClick:()=>act('停止监控目录',()=>call('/folders',{action:'remove',id:f.id}))},'停止监控'))),
   h('p',{className:'ab-small ab-muted'},'每5秒检查第一层目录，跳过仍在写入的文件，同一内容不重复导入。建议命名“歌名_演唱者”或“歌名.m4a”；停止监控不会删除原曲或旧成品。'),
   folders.lastResult?h('p',{className:'ab-small'},'最近扫描：新增 '+folders.lastResult.imported+'，复用已有 '+folders.lastResult.reused+'，等待文件稳定 '+folders.lastResult.waiting+'；已登记 '+folders.lastResult.tracked+' 个文件'):null,
   folders.error?h('p',{className:'ab-note err'},folders.error):null,(folders.lastResult?.errors||[]).map((e,i)=>h('p',{key:i,className:'ab-note warn'},e))
  )):null,
  h(ui.Card,{title:'② 选择歌曲与片段',desc:'本次起点、时长和歌词只用于这首的本机制作，不修改QQ默认设置。'},
   h(ui.Row,{label:'歌曲来源'},h(ui.Select,{value:kind,onChange:setKind,options:[{value:'local',label:'本机导入 / 原曲缓存'},{value:'netease',label:'搜索网易云候选'}]})),
   kind==='local'?h(React.Fragment,null,h(ui.Row,{label:'本机歌曲'},h(ui.Select,{value:source,onChange:setSource,width:340,options:data.sources.map(x=>({value:x.id,label:x.label}))})),h(ui.Btn,{disabled:!!busy,onClick:chooseFile},'选择歌曲文件并导入'),
    song?h(ui.Row,{label:'登记歌名'},h('div',null,h('input',{className:'ab-input',value:titleDraft?.[source]??song.title,onChange:e=>setTitleDraft({...titleDraft,[source]:e.target.value}),'aria-label':'本地曲目的点歌名称'}),h(ui.Btn,{disabled:!!busy,onClick:()=>act('保存登记歌名',()=>call('/local-source',{sourceId:source,title:titleDraft?.[source]??song.title,artists:song.artists||'',songArtists:song.songArtists||[],aliases:song.aliases||[]}))},'保存歌名'))):null,
    h('p',{className:'ab-small ab-muted'},'本地按登记歌名找，可使用任何人的翻唱；普通歌手提示不会要求原唱本人。只有明确指定“某人版／原唱版”才限制来源。')):h(React.Fragment,null,
    h('input',{className:'ab-input',value:query,onChange:e=>setQuery(e.target.value),placeholder:'歌名 + 歌手'}),
    h(ui.Btn,{disabled:!!busy||!query.trim(),onClick:()=>act('搜索',async()=>{const r=await call('/search?q='+encodeURIComponent(query));if(r.ok){setFound(r.list||[]);setSongId('');}return r;})},'搜索候选'),
    h(ui.Select,{value:songId,onChange:setSongId,width:340,options:[{value:'',label:'请明确选择歌曲和版本'},...found.map(x=>({value:String(x.id),label:x.name+' · '+x.artists}))]})),
   h(ui.Row,{label:'本次开始秒数'},h('input',{type:'number',className:'ab-input',min:0,max:7200,value:start,onChange:e=>setStart(e.target.value)})),
   h(ui.Row,{label:'本次制作长度'},h(ui.Select,{value:seconds,onChange:setSeconds,options:[10,15,30,60,120,180].map(n=>({value:String(n),label:n+'秒'+(n===10?' · 建议先试听':'')}))})),
   p?.engine==='breeze'?h('textarea',{className:'ab-input',rows:2,value:lyrics,maxLength:1200,onChange:e=>setLyrics(e.target.value),placeholder:'可选：对应片段的准确歌词，帮助咬字。无需填整首。'}):null,
   h(ui.Btn,{kind:'primary',disabled:!!busy||data.busy||data.qq?.active||!p?.ready||!sourceValid,onClick:()=>act('开始制作',()=>call('/start',{profileRevision:p.revision,startSec:Number(start),durationSec:Number(seconds),lyrics:p.engine==='breeze'?lyrics:'',...(kind==='local'?{sourceId:source}:{songId,title:found.find(x=>String(x.id)===songId)?.name||'网易云歌曲'})}))},busy||'按统一设置开始本机制作（不发QQ）'),
   h('p',{className:'ab-small ab-muted'},'当前支持1–180秒片段。Breeze属于实验换声，可能改变旋律或咬字；设置若在点击前变化，系统会要求重新确认，不会用旧草稿偷偷制作。')),
  h('div',{style:{gridColumn:'1 / -1'}},h(ui.Card,{title:'QQ点歌请求 · 引擎与发送记录',desc:'这是统一路由的QQ请求；旧翻唱页的历史仍属于原RVC流程。'},
   h('p',{className:'ab-small ab-muted'},'Breeze QQ选歌：已导入本地原曲优先，没有匹配才搜网易云；本地多个同名版本需确认。明确说“网易云”可跳过本地。网搜时普通录音室版优先，Live、Remix、翻唱排后。'),
   h('p',{className:data.qq?.guardInstalled?'ab-note':'ab-note err'},'当前QQ：'+(p?.engineName||'未就绪')+' · '+(data.qq?.guardInstalled?'路由已接管':'路由未接管，请停止点歌')),
   !(data.qq?.requests||[]).length?h('p',{className:'ab-small'},'尚无新的QQ请求，旧RVC成品不会改名冒充Breeze。'):data.qq.requests.slice(0,8).map(r=>h('div',{key:r.id,className:'ab-note'},
    h('strong',null,(r.title||r.query)+' · '+r.engine.toUpperCase()+' · '+r.voiceName+' · '+(r.arrangement==='acappella'?'清唱':'带伴奏')),
    h('p',{className:'ab-small ab-muted'},(r.createdAt?new Date(r.createdAt).toLocaleString('zh-CN',{hour12:false}):'')+' · '+(r.status==='superseded'?'历史未制作记录 · 旧规则已更新':r.status)),
    h('p',{className:'ab-small'},r.message),r.sourceSelection?h('p',{className:'ab-small'},(r.sourceSelection.mode==='auto'?'自动选歌：':'手动选歌：')+(r.sourceSelection.origin==='local'?'[本地原曲] ':r.sourceSelection.origin==='netease'?'[网易云] ':r.sourceSelection.origin==='library-source'?'[库内原曲ID] ':'')+r.sourceSelection.name+' — '+r.sourceSelection.artists+(r.sourceSelection.reason?'；'+r.sourceSelection.reason:'')):null,r.jobId?h('p',{className:'ab-small'},'任务：'+r.jobId.slice(0,8)+(r.actualEngine?'；已提交实际结果：'+r.actualEngine+' / '+r.actualVoice:'；尚未提交QQ成品')):null,
    ['superseded','source_unavailable','failed'].includes(r.status)?h(ui.Btn,{disabled:!!busy||data.busy||data.qq.active||!p?.ready||!data.qq.guardInstalled,onClick:()=>act('按当前声音重新点歌',()=>call('/qq/retry',{id:r.id,profileRevision:p.revision}))},'按当前设置重试（制作后发QQ）'):null,
    r.status==='needs_choice'?(r.candidates||[]).map((x,i)=>h(ui.Btn,{key:x.id,disabled:!!busy||data.busy||data.qq.active,onClick:()=>act('确认歌曲',()=>call('/qq/choose',{id:r.id,index:i+1}))},(i+1)+'. '+(x.kind==='local'?'[本地] '+x.label:x.name+' — '+x.artists+(x.version?' · '+x.version:'')))):null))
  )),
  h('div',{style:{gridColumn:'1 / -1'}},h(ui.Card,{title:'③ 制作进度与试听',desc:'每个任务会保留清唱与伴奏两份文件，不代表同时跑了两种引擎。旧任务继续显示它当时真实使用的声音。'},
   !data.jobs.length?h('p',{className:'ab-small'},'还没有制作任务。'):data.jobs.slice(0,8).map(j=>h('div',{key:j.id,className:'ab-note',style:{marginBottom:12}},
    h('strong',null,j.title+' · '+j.voiceName+' · '+(j.engine==='breeze'?'Breeze CPP':'RVC')),h('p',null,j.stage),j.error?h('p',{className:'ab-note err'},j.error):null,
    j.status==='done'?h(React.Fragment,null,(j.warnings||[]).map((w,i)=>h('p',{key:i,className:'ab-small'},w)),['acappella','mixed'].map(a=>h('div',{key:a},h('p',{className:'ab-small'},a==='acappella'?'清唱版 · 只含换声人声':'带伴奏版'),h('audio',{controls:true,preload:'none',src:BASE+'/audio?id='+encodeURIComponent(j.id)+'&arrangement='+a,style:{width:'100%'}}),h(ui.Btn,{disabled:!!busy,onClick:()=>{if(window.confirm('将这份 '+j.engine.toUpperCase()+' / '+j.voiceName+' / '+(a==='acappella'?'清唱':'带伴奏')+' 结果发送到主人QQ？'))act('发送QQ',()=>call('/send',{id:j.id,arrangement:a,expectedEngine:j.engine,expectedVoice:j.voice}));}},'发送此版本到主人QQ')))):['queued','running'].includes(j.status)?h(ui.Btn,{disabled:!!busy,onClick:()=>act('取消',()=>call('/cancel',{id:j.id}))},'取消本机任务'):null))
  ))
 );
};
