const {useState,useEffect}=React;
const BASE='/aurabot/api/ext/breeze-cover';
return function BreezeCover({toast}){
 const [data,setData]=useState(null),[engine,setEngine]=useState('breeze'),[voice,setVoice]=useState(''),[rvcVoice,setRvcVoice]=useState(''),[arr,setArr]=useState('mixed'),[keep,setKeep]=useState('0'),[source,setSource]=useState(''),[kind,setKind]=useState('local'),[query,setQuery]=useState(''),[found,setFound]=useState([]),[songId,setSongId]=useState(''),[start,setStart]=useState('0'),[seconds,setSeconds]=useState('10'),[lyrics,setLyrics]=useState(''),[pitch,setPitch]=useState('0'),[error,setError]=useState(''),[busy,setBusy]=useState('');
 const load=async(initial=false)=>{try{const r=await call('/state');if(!r.ok)throw Error(r.message);setData(r);if(initial){setVoice(r.selectedVoice);setRvcVoice(r.rvcVoice);setPitch(String(r.rvcPitch??0));setKeep(String(r.keepMelody));setArr(r.breezeArrangement);setSource(r.sources[0]?.id||'');}setError('');}catch(e){setError(e.message||String(e));}};
 useEffect(()=>{load(true);const t=setInterval(()=>load(),2000);return()=>clearInterval(t);},[]);
 const act=async(label,fn)=>{setBusy(label);setError('');try{const r=await fn();if(r.ok===false)throw Error(r.message||'操作失败');toast(r.message||'已完成','ok');await load();return r;}catch(e){setError(e.message||String(e));toast(e.message||String(e),'err');}finally{setBusy('');}};
 const swap=e=>{setEngine(e);if(data)setArr(e==='breeze'?data.breezeArrangement:data.rvcArrangement);};
 const importFile=async file=>{if(!file)return;if(file.size>64*1024*1024)return setError('文件最大64MB');await act('导入歌曲',async()=>{const r=await fetch(BASE+'/import?name='+encodeURIComponent(file.name),{method:'POST',body:file});const s=await r.json();if(s.ok&&s.sources?.length)setSource(s.sources[0].id);return s;});};
 const chooseFile=()=>{const el=document.createElement('input');el.type='file';el.accept='.mp3,.wav,.flac,.m4a,.aac,.ogg,.opus,.mp4,.webm';el.onchange=()=>importFile(el.files?.[0]);el.click();};
 if(!data)return h(ui.Card,{title:'Breeze / RVC 本机翻唱'},h('p',null,error||'正在读取…'),h(ui.Btn,{onClick:()=>load(true)},'重新读取'));
 const list=engine==='breeze'?data.voices:data.rvcVoices,selectedVoice=engine==='breeze'?voice:rvcVoice;
 return h(React.Fragment,null,
  h('div',{className:'ab-note warn',style:{gridColumn:'1 / -1'}},'先本机试听，再决定是否发送。Breeze 是实验换声，可能改变音高、旋律或咬字；原RVC点歌保持不变。当前支持1–180秒片段，较长歌曲不会偷偷截成整首冒充。'),
  error?h('div',{className:'ab-note err',role:'alert',style:{gridColumn:'1 / -1'}},error):null,
  h(ui.Card,{title:'① 选择声音与版本',desc:'讲话声音、Breeze翻唱与RVC翻唱分别保存。'},
   h(ui.Row,{label:'翻唱引擎'},h(ui.Select,{value:engine,onChange:swap,options:[{value:'breeze',label:'Breeze CPP · 实验换声'},{value:'rvc',label:'RVC · 既有模型'}]})),
   h(ui.Row,{label:'翻唱音色'},h(ui.Select,{value:selectedVoice,onChange:engine==='breeze'?setVoice:setRvcVoice,width:300,options:list.map(x=>({value:x.id,label:x.name}))})),
   engine==='rvc'?h(ui.Row,{label:'RVC变调（半音）'},h('input',{type:'number',className:'ab-input',min:-24,max:24,value:pitch,onChange:e=>setPitch(e.target.value)})):null,
   h(ui.Row,{label:'输出版本'},h(ui.Select,{value:arr,onChange:setArr,options:[{value:'mixed',label:'带伴奏版'},{value:'acappella',label:'清唱版 · 只有换声人声'}]})),
   engine==='breeze'?h(ui.Row,{label:'保留旋律'},h(ui.Select,{value:keep,onChange:setKeep,options:[{value:'0',label:'默认（先试这个）'},{value:'1',label:'加强保留（1）'},{value:'2',label:'更强保留（2，需试听）'}]})):null,
   h(ui.Btn,{disabled:!!busy,onClick:()=>act('保存设置',()=>call('/settings',engine==='breeze'?{voice,keepMelody:Number(keep),breezeArrangement:arr}:{rvcArrangement:arr}))},'保存本引擎的版本设置')),
  h(ui.Card,{title:'② 选择歌曲',desc:'可用本机原曲、导入文件或已有登录权限的网易云歌曲。'},
   h(ui.Row,{label:'歌曲来源'},h(ui.Select,{value:kind,onChange:setKind,options:[{value:'local',label:'本机导入 / 原曲缓存'},{value:'netease',label:'搜索网易云候选'}]})),
   kind==='local'?h(React.Fragment,null,h(ui.Row,{label:'本机歌曲'},h(ui.Select,{value:source,onChange:setSource,width:320,options:data.sources.map(x=>({value:x.id,label:x.label}))})),h(ui.Btn,{disabled:!!busy,onClick:chooseFile},'选择歌曲文件并导入')):h(React.Fragment,null,h('input',{className:'ab-input',value:query,onChange:e=>setQuery(e.target.value),placeholder:'歌名 + 歌手'}),h(ui.Btn,{disabled:!!busy||!query.trim(),onClick:()=>act('搜索',async()=>{const r=await call('/search?q='+encodeURIComponent(query));if(r.ok){setFound(r.list||[]);setSongId(String(r.list?.[0]?.id||''));}return r;})},'搜索候选'),h(ui.Select,{value:songId,onChange:setSongId,width:320,options:found.map(x=>({value:String(x.id),label:x.name+' · '+x.artists}))})),
   h(ui.Row,{label:'开始秒数'},h('input',{type:'number',className:'ab-input',min:0,max:7200,value:start,onChange:e=>setStart(e.target.value)})),
   h(ui.Row,{label:'制作长度'},h(ui.Select,{value:seconds,onChange:setSeconds,options:[10,15,30,60,120,180].map(n=>({value:String(n),label:n+'秒'+(n===10?' · 建议先试听':'' )}))})),
   engine==='breeze'?h('textarea',{className:'ab-input',rows:2,value:lyrics,maxLength:1200,onChange:e=>setLyrics(e.target.value),placeholder:'可选：这段歌曲对应的歌词，帮助咬字。无需填整首。'}):null,
   h(ui.Btn,{kind:'primary',disabled:!!busy||data.busy||!selectedVoice||!(engine==='breeze'?data.ready:data.rvcReady),onClick:()=>act('开始制作',()=>call('/start',{engine,voice:selectedVoice,arrangement:arr,keepMelody:Number(keep),startSec:Number(start),durationSec:Number(seconds),lyrics,pitch:Number(pitch),...(kind==='local'?{sourceId:source}:{songId,title:found.find(x=>String(x.id)===songId)?.name||'网易云歌曲'})}))},busy||'开始本机制作（不发QQ）')),
  h('div',{style:{gridColumn:'1 / -1'}},h(ui.Card,{title:'③ 制作进度与试听',desc:'清唱和带伴奏分别保留，可直接切换试听，不会覆盖另一版。'},
   !data.jobs.length?h('p',{className:'ab-muted'},'还没有本机翻唱任务。'):data.jobs.slice(0,8).map(j=>h('div',{key:j.id,className:'ab-note',style:{marginBottom:12}},
    h('strong',null,j.title+' · '+j.voiceName+' · '+j.engine.toUpperCase()),h('p',null,j.stage),j.error?h('p',{className:'ab-note err'},j.error):null,
    j.status==='done'?h(React.Fragment,null,(j.warnings||[]).map((w,i)=>h('p',{key:i,className:'ab-small'},w)),['acappella','mixed'].map(a=>h('div',{key:a},h('p',{className:'ab-small'},a==='acappella'?'清唱版 · 不含伴奏':'带伴奏版'),h('audio',{controls:true,preload:'none',src:BASE+'/audio?id='+encodeURIComponent(j.id)+'&arrangement='+a,style:{width:'100%'}}),h(ui.Btn,{disabled:!!busy,onClick:()=>{if(window.confirm('将这份'+(a==='acappella'?'清唱':'带伴奏')+'结果发送到主人QQ？'))act('发送QQ',()=>call('/send',{id:j.id,arrangement:a}));}},'发送此版本到主人QQ')))):['queued','running'].includes(j.status)?h(ui.Btn,{disabled:!!busy,onClick:()=>act('取消',()=>call('/cancel',{id:j.id}))},'取消本机任务'):null))
  ))
 );
};
