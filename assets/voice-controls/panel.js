const {useState,useEffect}=React;
return function VoiceControls({toast,reload}){
 const [data,setData]=useState(null),[speech,setSpeech]=useState(''),[mode,setMode]=useState('auto'),[engine,setEngine]=useState('breeze'),[breezeVoice,setBreezeVoice]=useState(''),[rvcVoice,setRvcVoice]=useState(''),[breezeArrangement,setBreezeArrangement]=useState('mixed'),[rvcArrangement,setRvcArrangement]=useState('mixed'),[keep,setKeep]=useState('0'),[pitch,setPitch]=useState('0'),[seconds,setSeconds]=useState('60'),[busy,setBusy]=useState(''),[error,setError]=useState('');
 const read=async()=>{try{const s=await call('/state');if(!s.ok)throw Error(s.message||'读取设置失败');setData(s);setSpeech(s.speech.selected);setMode(s.reply.selected);setEngine(s.coverRouting?.engine||'breeze');setBreezeVoice(s.breezeCover?.selectedVoice||'');setRvcVoice(s.rvc.selected);setBreezeArrangement(s.breezeCover?.arrangement||'mixed');setRvcArrangement(s.rvc.arrangement||'mixed');setKeep(String(s.breezeCover?.keepMelody??0));setPitch(String(s.rvc.pitch??0));setSeconds(String(s.coverRouting?.qqDurationSec??60));setError('');}catch(e){setError(e.message||String(e));}};
 useEffect(()=>{read();},[]);
 const save=async(kind,value,extra={})=>{setBusy(kind);setError('');try{const r=await call('/select',kind==='reply'?{kind,mode:value}:kind==='reuse'?{kind,enabled:value}:{kind,voice:value,...extra});if(!r.ok)throw Error(r.message||'保存失败');setData(r);toast(r.message,'ok');reload();}catch(e){setError(e.message||String(e));toast(e.message||String(e),'err');}finally{setBusy('');}};
 if(!data)return h(ui.Card,{title:'音色切换'},h('p',null,error||'正在读取…'),h(ui.Btn,{onClick:read},'重新读取'));
 const profile=data.coverRouting?.profile;
 const reuseFinished=data.coverRouting?.reuseFinished!==false;
 const voice=engine==='breeze'?breezeVoice:rvcVoice,arrangement=engine==='breeze'?breezeArrangement:rvcArrangement;
 const voices=engine==='breeze'?(data.breezeCover?.voices||[]):data.rvc.voices;
 const selectedSpeech=data.speech.voices.find(x=>x.id===data.speech.selected);
 const dirty=!!profile&&(profile.engine!==engine||profile.voice!==voice||profile.arrangement!==arrangement||(engine==='breeze'?profile.keepMelody!==Number(keep):profile.pitch!==Number(pitch))||Number(seconds)!==data.coverRouting.qqDurationSec);
 return h(React.Fragment,null,
  h('div',{className:'ab-note',style:{gridColumn:'1 / -1'}},'这里是唯一的声音设置入口。翻唱制作页只读这些设置，不再另存一套。保存设置不会立即制作或发送QQ。'),
  error?h('div',{className:'ab-note err',role:'alert',style:{gridColumn:'1 / -1'}},error):null,
  h(ui.Card,{title:'普通聊天 · 回复方式',desc:'只控制平时聊天，不改变歌曲、图片和文件。'},
   h(ui.Row,{label:'怎么回话'},h(ui.Select,{value:mode,onChange:setMode,options:data.reply.modes.map(x=>({value:x.id,label:x.name}))})),
   h('p',{className:'ab-small ab-muted'},data.reply.modes.find(x=>x.id===mode)?.description||''),
   h(ui.Btn,{disabled:!!busy,onClick:()=>save('reply',mode)},'保存回复方式')),
  h(ui.Card,{title:'普通聊天 · 讲话声音',desc:'平时朗读文字的声音；与唱歌分开。'},
   h('p',{className:'ab-small ab-muted'},'已生效：'+(selectedSpeech?.name||data.speech.selected)),
   h(ui.Row,{label:'讲话音色'},h(ui.Select,{value:speech,onChange:setSpeech,width:300,options:data.speech.voices.map(x=>({value:x.id,label:x.name}))})),
   !data.speech.enabled?h('p',{className:'ab-note warn'},'Breeze讲话当前关闭；保存音色不会自动打开。'):null,
   h(ui.Btn,{disabled:!!busy||!data.speech.voices.some(x=>x.id===speech),onClick:()=>save('speech',speech)},'保存讲话音色')),
  h('div',{style:{gridColumn:'1 / -1'}},h(ui.Card,{title:'翻唱 · 统一设置',desc:'QQ点歌和翻唱制作共用这一份设置。只显示当前引擎的参数，另一引擎的备用参数会保留。'},
   profile?h('div',{className:'ab-note',style:{borderLeft:'4px solid var(--ab-primary, #3678c8)'}},h('strong',null,'已生效：'+profile.engineName+' / '+profile.voiceName+' / '+profile.arrangementName),h('p',{className:'ab-small',style:{marginBottom:0}},'QQ默认片段：'+data.coverRouting.qqDurationSec+'秒；'+(profile.engine==='breeze'?'保留旋律 '+profile.keepMelody:'RVC变调 '+profile.pitch+' 半音'))):h('p',{className:'ab-note warn'},'统一翻唱模块未就绪，请检查扩展状态。'),
   data.coverRouting&&!data.coverRouting.guardInstalled?h('p',{className:'ab-note err'},'QQ路由未接管，请先检查扩展，避免走旧入口。'):null,
   h(ui.Row,{label:'已翻唱成品'},h('button',{type:'button',role:'switch','aria-checked':reuseFinished,className:'ab-btn'+(reuseFinished?' primary':''),disabled:!!busy||!data.coverRouting,onClick:()=>save('reuse',!reuseFinished)},reuseFinished?'成品优先：已开启 · 点此关闭':'重新翻唱：已开启 · 点此恢复成品优先')),
   h('p',{className:'ab-small ab-muted'},reuseFinished?'开启：优先复用当前引擎、音色和清唱/伴奏版本对应的成品；没有匹配就用当前音色制作。':'关闭：不播放旧成品，按当前音色重新换声；同一片段已分离的人声和伴奏仍可复用，避免重复等CPU分离。'),
   h('p',{className:'ab-small ab-muted'},'这是“旧成品”开关，不是“本地原曲”开关。想换新音色：先保存下面的音色，再点歌。想跳过本地原曲：说“用网易云唱＋歌名”。切换按钮立即保存，只影响之后的新请求，不会立刻制作或发QQ。'),
   h(ui.Row,{label:'翻唱引擎'},h(ui.Select,{value:engine,onChange:setEngine,options:[{value:'breeze',label:'Breeze CPP · 实验换声'},{value:'rvc',label:'RVC · CPU'}]})),
   h(ui.Row,{label:'翻唱音色'},h(ui.Select,{value:voice,onChange:engine==='breeze'?setBreezeVoice:setRvcVoice,width:320,options:voices.map(x=>({value:x.id,label:x.name||x.id}))})),
   h(ui.Row,{label:'输出版本'},h(ui.Select,{value:arrangement,onChange:engine==='breeze'?setBreezeArrangement:setRvcArrangement,options:[{value:'acappella',label:'清唱 · 只有换声人声'},{value:'mixed',label:'带伴奏'}]})),
   engine==='breeze'?h(ui.Row,{label:'保留旋律'},h(ui.Select,{value:keep,onChange:setKeep,options:[{value:'0',label:'默认（0）'},{value:'1',label:'加强保留（1）'},{value:'2',label:'更强保留（2，需试听）'}]})):h(ui.Row,{label:'RVC默认变调（半音）'},h('input',{type:'number',className:'ab-input',min:-24,max:24,step:1,value:pitch,onChange:e=>setPitch(e.target.value)})),
   h(ui.Row,{label:'QQ默认片段长度'},h(ui.Select,{value:seconds,onChange:setSeconds,options:[10,15,30,60,120,180].map(n=>({value:String(n),label:n+'秒'}))})),
   dirty?h('p',{className:'ab-note warn'},'下面的修改尚未保存；点击保存后两处一起生效。'):null,
   h(ui.Btn,{kind:'primary',disabled:!!busy||!data.coverRouting||!voices.some(x=>x.id===voice),onClick:()=>save('cover',voice,{engine,arrangement,keepMelody:Number(keep),pitch:Number(pitch),qqDurationSec:Number(seconds)})},busy==='cover'?'正在保存…':'保存统一翻唱设置'),
   h('p',{className:'ab-small ab-muted',style:{marginTop:10}},'保存后，点上方「翻唱制作」选歌试听。本机每首的起点、时长和歌词在制作页指定，不反向改QQ默认。Breeze不可用就停止，不回退RVC；已有成品不会因此重做。')))
 );
};
