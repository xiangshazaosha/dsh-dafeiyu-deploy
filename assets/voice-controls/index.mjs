export const REPLY_MODES = [
  {id:'auto',name:'自动混合（保持原来的方式）',description:'按原有概率和对话需要选择文字或语音。'},
  {id:'text',name:'仅文字',description:'普通聊天内容只发文字，不生成朗读语音。'},
  {id:'voice',name:'仅语音',description:'普通聊天内容转为语音；语音失败时仍会用文字保底。'},
  {id:'both',name:'文字＋语音',description:'同一段回复先发文字，再发对应语音。'},
];
export function formatReplyItems(items, mode) {
  if(mode==='auto'||!REPLY_MODES.some(m=>m.id===mode))return items;
  return items.flatMap(item=>{
    if(item.kind!=='text'&&item.kind!=='voice')return [item];
    if(mode==='text')return [{...item,kind:'text'}];
    // Split long spoken replies without dropping content; Breeze accepts <=1200 UTF-16 units.
    const value=String(item.value??'');
    if(!value.trim())return mode==='both'?[{...item,kind:'text'}]:[];
    const chunks=[];
    let chunk='';
    for(const cp of value){if(chunk.length+cp.length>1000){chunks.push(chunk);chunk='';}chunk+=cp;}
    if(chunk)chunks.push(chunk);
    const audio=chunks.map(value=>({...item,kind:'voice',value}));
    return mode==='voice'?audio:[{...item,kind:'text'},...audio];
  });
}
export default {
  id: 'voice-controls', name: '音色切换', version: '1.1.0', api: 1,
  description: '选择讲话和翻唱音色，以及仅文字、仅语音或文字加语音的回复方式。',
  panel: 'panel.js',
  setup(api) {
    const state = () => {
      const cfg = api.config();
      const speech = api.use('voice');
      const song = api.use('song');
      const voices = speech?.breezeVoices?.() || [];
      const rvc = song?.status?.()?.voices || [];
      return { ok: true, reply: {selected:cfg.ext?.['voice-controls']?.replyMode||'auto',modes:REPLY_MODES,voiceEnabled:!!cfg.voice?.enabled}, speech: { selected: cfg.ext?.voice?.breezeVoice || 'qinglan', enabled: cfg.ext?.voice?.breezeEnabled !== false, voices }, rvc: { selected: cfg.song?.voice || '', voices: rvc } };
    };
    api.route('/state', state);
    api.route('/select', async req => {
      const body = await api.core.http.body(req);
      const current = state();
      if(body.kind==='reply'){
        if(!REPLY_MODES.some(m=>m.id===body.mode))return {ok:false,message:'请选择列表中的回复方式。'};
        if((body.mode==='voice'||body.mode==='both')&&typeof api.use('voice')?.speak!=='function')return {ok:false,message:'语音模块没在运行，请先在「扩展」里打开语音模块。'};
        api.setConfig({ext:{'voice-controls':{replyMode:body.mode}},...((body.mode==='voice'||body.mode==='both')?{voice:{enabled:true}}:{})});
        return {...state(),message:'回复方式已保存，从下一次普通聊天回复起生效。'};
      }
      if (body.kind === 'speech') {
        if (!current.speech.voices.some(v => v.id === body.voice)) return {ok:false,message:'请选择列表中的讲话音色。'};
        api.setConfig({ext:{voice:{breezeVoice:body.voice}}});
        return {ok:true,message:'讲话音色已保存，翻唱音色未改变。',...state()};
      }
      if (body.kind === 'rvc') {
        if (!current.rvc.voices.some(v => v.id === body.voice)) return {ok:false,message:'请选择列表中的翻唱音色。'};
        api.setConfig({song:{voice:body.voice}});
        return {ok:true,message:'翻唱音色已保存，讲话音色未改变。',...state()};
      }
      return {ok:false,message:'请选择讲话或翻唱。'};
    });
    api.on('reply/items',items=>formatReplyItems(items,api.config().ext?.['voice-controls']?.replyMode||'auto'));
    return {state,formatReplyItems};
  },
};
