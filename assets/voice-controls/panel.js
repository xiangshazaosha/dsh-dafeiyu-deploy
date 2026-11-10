const {useState,useEffect}=React;
return function VoiceControls({toast,reload}) {
  const [data,setData]=useState(null);
  const [speech,setSpeech]=useState('');
  const [rvc,setRvc]=useState('');
  const [busy,setBusy]=useState('');
  const [error,setError]=useState('');
  const [mode,setMode]=useState('auto');
  const [breezeVoice,setBreezeVoice]=useState('');
  const [breezeArrangement,setBreezeArrangement]=useState('mixed');
  const [rvcArrangement,setRvcArrangement]=useState('mixed');
  const [keepMelody,setKeepMelody]=useState('0');
  const read=async()=>{
    try{
      const s=await call('/state');
      if(!s.ok)throw Error(s.message||'读不到当前音色');
      setData(s);setSpeech(s.speech.selected);setRvc(s.rvc.selected);setMode(s.reply.selected);setRvcArrangement(s.rvc.arrangement||'mixed');setBreezeVoice(s.breezeCover?.selectedVoice||'');setBreezeArrangement(s.breezeCover?.arrangement||'mixed');setKeepMelody(String(s.breezeCover?.keepMelody??0));setError('');
    }catch(e){setError(String(e.message||e));}
  };
  useEffect(()=>{read();},[]);
  const apply=async(kind,voice,extra={})=>{
    setBusy(kind);setError('');
    try{
      const result=await call('/select',kind==='reply'?{kind,mode:voice}:{kind,voice,...extra});
      if(!result.ok)throw Error(result.message||'保存失败');
      setData(result);toast(result.message,'ok');reload();
    }catch(e){setError(String(e.message||e));toast(String(e.message||e),'err');}
    finally{setBusy('');}
  };
  if(!data)return h(ui.Card,{title:'音色切换'},error?h('div',{className:'ab-note err',role:'alert'},error):h('p',null,'正在读取音色…'),h(ui.Btn,{onClick:read},'重新读取'));
  const currentSpeech=data.speech.voices.find(v=>v.id===data.speech.selected);
  return h(React.Fragment,null,
    h('div',{className:'ab-note',style:{gridColumn:'1 / -1'}},'讲话与翻唱分开选择。点击对应的保存按钮就会生效，不会发送 QQ 消息。'),
    error?h('div',{className:'ab-note err',role:'alert',style:{gridColumn:'1 / -1'}},error):null,
    h('div',{style:{gridColumn:'1 / -1'}},h(ui.Card,{title:'回复方式',desc:'控制普通 QQ 聊天内容的发送形式；不改变命令提示、图片表情、翻唱和文件。'},
      h('p',{className:'ab-muted ab-small'},'当前：'+(data.reply.modes.find(m=>m.id===data.reply.selected)?.name||'自动混合')),
      h(ui.Row,{label:'怎么回话'},h(ui.Select,{value:mode,onChange:setMode,width:310,options:data.reply.modes.map(m=>({value:m.id,label:m.name}))})),
      h('p',{className:'ab-note',style:{marginTop:8}},data.reply.modes.find(m=>m.id===mode)?.description||''),
      h(ui.Btn,{kind:'primary',disabled:!!busy,onClick:()=>apply('reply',mode)},busy==='reply'?'正在保存…':'保存回复方式'),
      h('p',{className:'ab-muted ab-small',style:{marginTop:12}},'选「仅语音」或「文字＋语音」会打开朗读开关。生成语音需要等待；失败时会保底发文字，避免漏回复。'))),
    h(ui.Card,{title:'讲话音色 · Breeze',desc:'平时把文字读出来的声音；不改变翻唱。'},
      h('p',{className:'ab-muted ab-small'},'当前：'+(currentSpeech?.name||data.speech.selected)),
      !data.speech.enabled?h('div',{className:'ab-note warn'},'Breeze 当前关闭；这里保存选择不会自动打开它。'):null,
      h(ui.Row,{label:'选择讲话声音'},h(ui.Select,{value:speech,onChange:setSpeech,width:260,options:data.speech.voices.map(v=>({value:v.id,label:v.name+' · '+v.description}))})),
      !data.speech.voices.length?h('p',{className:'ab-note warn'},'Breeze 模块没有就绪，请检查「扩展」。'):null,
      h(ui.Btn,{kind:'primary',disabled:!!busy||!data.speech.voices.some(v=>v.id===speech),onClick:()=>apply('speech',speech)},busy==='speech'?'正在保存…':'保存讲话音色')),
    data.breezeCover?h(ui.Card,{title:'Breeze 实验翻唱',desc:'用已保存的Breeze音色唱已有歌曲，不需要RVC模型；可能改变旋律，先本机试听。'},
      h(ui.Row,{label:'Breeze翻唱音色'},h(ui.Select,{value:breezeVoice,onChange:setBreezeVoice,width:300,options:data.breezeCover.voices.map(v=>({value:v.id,label:v.name}))})),
      h(ui.Row,{label:'Breeze输出版本'},h(ui.Select,{value:breezeArrangement,onChange:setBreezeArrangement,options:[{value:'mixed',label:'带伴奏版'},{value:'acappella',label:'清唱版 · 只有换声后人声'}]})),
      h(ui.Row,{label:'保留旋律'},h(ui.Select,{value:keepMelody,onChange:setKeepMelody,options:[{value:'0',label:'默认（0）'},{value:'1',label:'加强保留（1）'},{value:'2',label:'更强保留（2，需试听）'}]})),
      h(ui.Btn,{kind:'primary',disabled:!!busy,onClick:()=>apply('breeze',breezeVoice,{arrangement:breezeArrangement,keepMelody:Number(keepMelody)})},'保存Breeze翻唱设置'),
      h('p',{className:'ab-note',style:{marginTop:10}},'制作和试听入口：Aurabot → 系统 → Breeze翻唱。保存设置不会自动开始制作或发送QQ。')):null,
    h(ui.Card,{title:'翻唱音色 · RVC',desc:'把已有演唱换成选定音色；不改变平时讲话。'},
      h('p',{className:'ab-muted ab-small'},'当前：'+data.rvc.selected),
      h(ui.Row,{label:'选择翻唱声音'},h(ui.Select,{value:rvc,onChange:setRvc,width:260,options:data.rvc.voices.map(v=>({value:v.id,label:v.id}))})),
      h(ui.Row,{label:'RVC输出版本'},h(ui.Select,{value:rvcArrangement,onChange:setRvcArrangement,options:[{value:'mixed',label:'带伴奏版'},{value:'acappella',label:'清唱版 · 只有换声后人声'}]})),
      h(ui.Btn,{kind:'primary',disabled:!!busy||!data.rvc.voices.some(v=>v.id===rvc),onClick:()=>apply('rvc',rvc,{arrangement:rvcArrangement})},busy==='rvc'?'正在保存…':'保存翻唱音色'),
      h('p',{className:'ab-muted ab-small',style:{marginTop:12}},'当前使用 CPU 换声。已做好的歌曲库成品不会因切换而重新制作。')),
  );
};
