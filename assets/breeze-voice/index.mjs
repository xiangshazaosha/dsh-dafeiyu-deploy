import { readFileSync } from 'node:fs';
import { createService, PRESETS, presetOf, readRuntime } from './service.mjs';

export default {
  id: 'voice', name: '语音 · Breeze TTS 2', version: '1.1.0', api: 1, tab: 'voice',
  description: '本机 AMD/Vulkan 语音与四种原创音色；保留原有语音识别和翻唱功能。',
  defaults: { breezeEnabled: true, breezeVoice: 'qinglan', breezeRoot: '' },
  settings: [
    { key: 'breezeEnabled', label: '使用本机 Breeze TTS 2', type: 'switch', hint: '开启时不上传文字；失败保留文字回复。关闭后恢复原有语音引擎。' },
    { key: 'breezeVoice', label: 'Breeze 说话音色', type: 'select', options: PRESETS.map(p => ({ value: p.id, label: `${p.name} · ${p.description}` })) },
  ],
  setup(api) {
    let service;
    try {
      service = createService({ runtime:readRuntime(api.settings().breezeRoot), log: api.log, onDispose: fn => api.onDispose(fn) });
    } catch (error) {
      // Keep this wrapper alive: throwing from setup would let the host silently
      // restore its builtin (possibly online) engine instead of a text fallback.
      api.log.warn?.('Breeze 本机配置未就绪，保持文字兜底；请修正配置后重新加载语音模块。');
      const fail=async()=>{throw new Error('Breeze 配置未就绪；不自动改用在线或系统声音：'+String(error.message||error));};
      service={synth:fail,convert:fail,health:async()=>null};
    }
    let legacy;
    async function speak(text) {
      if (api.settings().breezeEnabled === false) return legacy.speak(text);
      return service.synth(text, api.settings().breezeVoice, api.dataDir('breeze-cache'));
    }
    // Delegate all existing ASR and diagnostics to the installed module, replacing only TTS/test.
    const builtin = api.lib('modules/voice/index.js').default;
    legacy = builtin.setup({ ...api, route(path, handler) {
      return api.route(path, path === '/voice/test' ? async req => {
        const b = await api.core.http.body(req);
        const r = await speak(String(b.text || '你好呀，我是大肥鱼。'));
        return { ok: true, engine: r.engine, mime: r.file.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg', data: readFileSync(r.file).toString('base64') };
      } : handler);
    } });
    const list = () => PRESETS.map(({id,name,description}) => ({id,name,description}));
    const select = value => {
      const p = presetOf(String(value).trim());
      if (!p) throw new Error('请选择晴岚、灵汐、晚宁或星舟。');
      api.saveSettings({ breezeVoice: p.id });
      return { ok: true, voice: p.id, message: `说话音色已切换为${p.name}；原有翻唱音色不变。` };
    };
    api.route('/breeze/status', async () => ({ ok: true, ready: Boolean(await service.health()), voice: api.settings().breezeVoice, localOnly: true }));
    api.route('/breeze/voices', async () => ({ ok: true, voices: list() }));
    api.route('/breeze/select', async req => select((await api.core.http.body(req)).voice));
    api.command({ name: '音色', desc: '列出或切换大肥鱼的本机说话音色，如 /音色 晴岚', run(arg) {
      if (!String(arg).trim()) return PRESETS.map(p => `${p.name}：${p.description}`).join('\n') + '\n切换：/音色 晴岚（这里只改变说话，不改变 RVC 翻唱）';
      return select(arg).message;
    } });
    api.tool?.(({chat,level,sessionId}) => {
      if(level!=='full'||chat.kind!=='private')return [];
      return api.defineTool({name:'breeze_convert_vocal',description:'仅在主人明确要求用 Breeze 实验换声时使用。把已有 WAV 独立人声换成晴岚/灵汐/晚宁/星舟。可能改变音高旋律，不替代正常 RVC 点歌；只保存本机文件，不自动发送。',
        properties:{source:{type:'string',description:'大肥鱼歌曲库或歌曲缓存中的独立人声 WAV 绝对路径，最多180秒'},voice:{type:'string',enum:PRESETS.map(p=>p.id)},text:{type:'string',description:'已有对应歌词，可省略'},keepMelody:{type:'integer',enum:[0,1,2],description:'默认0，唱歌旋律丢失时才尝试1或2'}},required:['source','voice'],
        execute:async({source,voice,text,keepMelody=0})=>{
          if(!api.core.hub.turnHasOwner(sessionId))return {ok:false,message:'只允许主人使用。'};
          const r=await service.convert(source,voice,{text,keepMelody,outputDir:api.dataDir('breeze-converted')});
          return {ok:true,message:JSON.stringify(r)};
        }});
    });
    return { ...legacy, speak, breezeVoices: list, breezeConvert: service.convert };
  },
};
