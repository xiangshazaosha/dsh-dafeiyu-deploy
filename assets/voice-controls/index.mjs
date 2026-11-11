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
  id: 'voice-controls', name: '音色切换', version: '1.6.0', api: 1,
  description: '选择讲话和翻唱音色，以及仅文字、仅语音或文字加语音的回复方式。',
  panel: 'panel.js',
  setup(api) {
    const state = () => {
      const cfg = api.config();
      const speech = api.use('voice');
      const song = api.use('song');
      const cover=api.use('breeze-cover')?.state?.();
      const voices = speech?.breezeVoices?.() || [];
      const rvc = song?.status?.()?.voices || [];
      return { ok: true, coverRouting:cover?{engine:cover.engine,profile:cover.profile,reuseFinished:cover.reuseFinished!==false,qqDurationSec:cover.qqDurationSec,guardInstalled:cover.qq?.guardInstalled}:null, reply: {selected:cfg.ext?.['voice-controls']?.replyMode||'auto',modes:REPLY_MODES,voiceEnabled:!!cfg.voice?.enabled}, speech: { selected: cfg.ext?.voice?.breezeVoice || 'qinglan', enabled: cfg.ext?.voice?.breezeEnabled !== false, voices }, rvc: { selected: cfg.song?.voice || '', voices: rvc, pitch:Number(cfg.song?.pitch)||0, arrangement:cover?.rvcArrangement||cfg.ext?.['breeze-cover']?.rvcArrangement||'mixed' }, breezeCover:cover?{selectedVoice:cover.selectedVoice,voices:cover.voices,ready:cover.ready,arrangement:cover.breezeArrangement,keepMelody:cover.keepMelody}:null };
    };
    api.route('/state', state);
    api.route('/select', async req => {
      const body = await api.core.http.body(req);
      const current = state();
      if(body.kind==='reuse'){
        if(typeof body.enabled!=='boolean')return {ok:false,message:'成品优先开关须为开启或关闭'};
        const cover=api.use('breeze-cover');if(!cover)return {ok:false,message:'翻唱模块未运行，未修改成品策略'};
        cover.selectSettings({reuseFinished:body.enabled});
        return {...state(),message:body.enabled?'已开启成品优先：仅复用符合当前引擎、音色和版本的成品。没有开始制作或发送。':'已关闭成品优先：下一单按选定音色重新换声；分离缓存保留。没有现在开始制作或发送。'};
      }
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
      if(body.kind==='cover'){
        const cover=api.use('breeze-cover');if(!cover)return {ok:false,message:'统一翻唱模块未运行，未修改设置'};
        if(!['breeze','rvc'].includes(body.engine))return {ok:false,message:'请选择Breeze或RVC'};
        if(!['mixed','acappella'].includes(body.arrangement))return {ok:false,message:'请选择清唱或带伴奏'};
        const list=body.engine==='breeze'?current.breezeCover?.voices:current.rvc.voices;
        if(!list?.some(v=>v.id===body.voice))return {ok:false,message:'请选择对应引擎列表中的音色'};
        const seconds=Number(body.qqDurationSec??current.coverRouting.qqDurationSec??60);
        if(!Number.isInteger(seconds)||seconds<1||seconds>180)return {ok:false,message:'QQ片段长度须为1–180秒'};
        if(body.engine==='breeze'){
          const keep=Number(body.keepMelody);if(![0,1,2].includes(keep))return {ok:false,message:'保留旋律须为0、1或2'};
          cover.selectSettings({engine:body.engine,voice:body.voice,breezeArrangement:body.arrangement,keepMelody:keep,qqDurationSec:seconds});
        }else{
          const pitch=Number(body.pitch??current.rvc.pitch);if(!Number.isInteger(pitch)||pitch<-24||pitch>24)return {ok:false,message:'RVC变调须为-24到24半音'};
          cover.selectSettings({engine:body.engine,rvcArrangement:body.arrangement,qqDurationSec:seconds});
          api.setConfig({song:{voice:body.voice,pitch,maxVoiceSec:seconds}});
        }
        return {...state(),message:'统一翻唱设置已保存，QQ与制作页共用；讲话音色和回复方式未变。'};
      }
      if(body.kind==='engine'){const cover=api.use('breeze-cover');if(!cover)return {ok:false,message:'统一翻唱模块未运行，未修改引擎'};cover.selectSettings({engine:body.voice,qqDurationSec:body.qqDurationSec});return {...state(),message:'QQ点歌默认引擎已保存，不会立刻制作或发送'};}
      if(body.kind==='breeze'){const cover=api.use('breeze-cover');if(!cover)return {ok:false,message:'Breeze翻唱模块未运行'};cover.selectSettings({voice:body.voice,breezeArrangement:body.arrangement,keepMelody:body.keepMelody});return {...state(),message:'Breeze翻唱音色和版本已保存，讲话及RVC设置不变。'};}
      if (body.kind === 'rvc') {
        if (!current.rvc.voices.some(v => v.id === body.voice)) return {ok:false,message:'请选择列表中的翻唱音色。'};
        if(body.arrangement!==undefined){if(!['mixed','acappella'].includes(body.arrangement))return {ok:false,message:'请选择清唱或带伴奏'};const cover=api.use('breeze-cover');if(cover)cover.selectSettings({rvcArrangement:body.arrangement});else api.setConfig({ext:{'breeze-cover':{rvcArrangement:body.arrangement}}});}
        api.setConfig({song:{voice:body.voice}});
        return {ok:true,message:'翻唱音色已保存，讲话音色未改变。',...state()};
      }
      return {ok:false,message:'请选择讲话或翻唱。'};
    });
    api.on('reply/items',items=>formatReplyItems(items,api.config().ext?.['voice-controls']?.replyMode||'auto'));
    return {state,formatReplyItems};
  },
};
