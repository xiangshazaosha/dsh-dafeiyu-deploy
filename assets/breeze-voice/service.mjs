import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, closeSync, writeFileSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, relative, isAbsolute, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export function readRuntime(root) {
  if(!root||!isAbsolute(root))throw new Error('请先设置 Breeze 的实际安装目录。');
  return runtimeOptions({...JSON.parse(readFileSync(join(root,'breeze-runtime.json'),'utf8')),root});
}
export function runtimeOptions(value) {
  if(!value?.root||!isAbsolute(value.root))throw new Error('Breeze root 必须为绝对路径。');
  const root=resolve(value.root),port=Number(value.port??18370);
  if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Breeze 端口不合法。');
  const file=(name)=>{
    if(typeof name!=='string'||!name)throw new Error('请指定已核对的程序和模型文件。');
    const p=resolve(root,name),r=relative(root,p);
    if(r.startsWith('..')||isAbsolute(r))throw new Error('程序和模型须放在所选 Breeze 根目录内。');
    return p;
  };
  return {...value,root,port,exe:file(value.exe),model:file(value.model),base:`http://127.0.0.1:${port}`,sourceRoots:Array.isArray(value.sourceRoots)?value.sourceRoots:[],disableCoopmat:value.disableCoopmat===true};
}
export const PRESETS = [
  { id: 'qinglan', name: '晴岚', description: '温柔清透女声', instruction: '一位年轻成年女性，温柔清透的中音，声音自然干净，有亲切的微笑感。标准普通话，轻松自然地聊天，不刻意撒娇，不用播音腔。', seed: 42 },
  { id: 'lingxi', name: '灵汐', description: '明亮活泼女声', instruction: '一位年轻成年女性，明亮清脆而不尖锐的声音，轻快有活力，带一点俏皮和笑意。标准普通话，像朋友聊天，咬字清晰，避免夸张表演。', seed: 314 },
  { id: 'wanning', name: '晚宁', description: '柔和偏低女声', instruction: '一位成年女性，柔和略低的中低音，温暖细腻，放松从容，带一点轻微气息感但不耳语。标准普通话，自然聊天，语速平稳，不用朗诵腔。', seed: 2718 },
  { id: 'xingzhou', name: '星舟', description: '温润清朗男声', instruction: '一位年轻成年男性，温润清朗的中低音，干净沉稳而有亲和力，不沙哑，不压低嗓子。标准普通话，像朋友一样自然聊天，语速适中。', seed: 2026 },
];
export function presetOf(value) { return PRESETS.find(p => p.id === value || p.name === value); }
export function validateText(value) {
  const text = String(value ?? '').trim();
  if (!text || text.length > 1200) throw new Error('语音文字需为 1–1200 字。');
  return text;
}
export function wavBuffer(pcm) {
  if (pcm.length < 2400 || pcm.length % 2) throw new Error('Breeze 返回的音频为空或不完整。');
  const h = Buffer.alloc(44);
  h.write('RIFF'); h.writeUInt32LE(pcm.length + 36, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(24000, 24); h.writeUInt32LE(48000, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
export function readSourceWav(source, allowedRoots=[]) {
  const file = realpathSync(String(source));
  if (!allowedRoots.some(root => { if(!existsSync(root))return false; const p=relative(realpathSync(root),file); return p && !p.startsWith('..') && !isAbsolute(p); })) throw new Error('音源须位于已明确允许的大肥鱼歌曲库、缓存或试听目录内。');
  if (statSync(file).size > 64*1024*1024) throw new Error('实验换声音源最大为 64 MB。');
  const audio=readFileSync(file);
  if(audio.toString('ascii',0,4)!=='RIFF'||audio.toString('ascii',8,12)!=='WAVE')throw new Error('请提供已分离人声的 WAV 文件，不接受整首带伴奏歌曲。');
  let byteRate=0, data=0;
  for(let i=12;i+8<=audio.length;) {
    const n=audio.readUInt32LE(i+4),id=audio.toString('ascii',i,i+4);
    if(i+8+n>audio.length)throw new Error('WAV 文件不完整。');
    if(id==='fmt '&&n>=16){
      const format=audio.readUInt16LE(i+8),channels=audio.readUInt16LE(i+10),rate=audio.readUInt32LE(i+12),align=audio.readUInt16LE(i+20),bits=audio.readUInt16LE(i+22);
      byteRate=audio.readUInt32LE(i+16);
      if(![1,3].includes(format)||![1,2].includes(channels)||![8,16,24,32].includes(bits)||align!==channels*bits/8||byteRate!==rate*align)throw new Error('WAV 格式不支持或字节率不完整。');
    }
    if(id==='data')data+=n;
    i+=8+n+(n%2);
  }
  if(!byteRate||!data||data/byteRate<1||data/byteRate>180)throw new Error('实验换声目前接受 1–180 秒的有效 WAV 人声。');
  return {audio,seconds:data/byteRate};
}
export async function health(runtime) {
  try {
    const r = await fetch(`${runtime.base}/health`, { signal: AbortSignal.timeout(1500) });
    const h = await r.json();
    return r.ok && h.status === 'ok' && h.sample_rate === 24000 ? h : null;
  } catch { return null; }
}
export function createService({ runtime, log = {}, onDispose = () => {} } = {}) {
  const options=runtimeOptions(runtime),ROOT=options.root,BASE=options.base;
  const checkHealth=()=>health(options);
  let child = null, starting = null, disposed = false, queue = Promise.resolve();
  onDispose(() => { disposed = true; if(child && child.exitCode === null) child.kill(); });
  async function ensure() {
    if (disposed) throw new Error('语音模块已停用。');
    if (await checkHealth()) return;
    if (starting) return starting;
    starting = (async () => {
      const {exe,model}=options;
      if (!existsSync(exe) || !existsSync(model)) throw new Error('Breeze 程序或模型尚未安装完整。');
      mkdirSync(join(ROOT, 'logs'), { recursive: true });
      const fd = openSync(join(ROOT, 'logs', `server-${Date.now()}.log`), 'a');
      try {
        const env={...process.env};
        // Opt in only after reproducing a driver-specific cooperative-matrix crash.
        if(options.disableCoopmat)env.GGML_VK_DISABLE_COOPMAT='1';
        child = spawn(exe, [model, '--host', '127.0.0.1', '--port', String(options.port), '--ws-port', '-1', '--voices-dir', join(ROOT, 'voices'), '--webui'], { cwd: join(ROOT, 'models'), windowsHide: true, env, stdio: ['ignore', fd, fd] });
      } finally { closeSync(fd); }
      let launchError = null;
      child.on('error', e => { launchError = e; });
      for (let n = 0; n < 120; n++) {
        if (disposed) throw new Error('语音模块已停用。');
        if (launchError) throw launchError;
        if (child.exitCode !== null) throw new Error(`Breeze 启动退出（${child.exitCode}），请检查本机日志。`);
        if (await checkHealth()) { log.info?.('Breeze 本机语音服务已就绪。'); return; }
        await new Promise(r => setTimeout(r, 1000));
      }
      if (child.exitCode === null) child.kill();
      throw new Error('Breeze 启动超时；保留文字回复，不改用在线或系统声音。');
    })().finally(() => { starting = null; });
    return starting;
  }
  function synth(textValue, voiceValue, outputDir = join(ROOT, 'samples')) {
    const text = validateText(textValue), preset = presetOf(voiceValue);
    if (!preset) return Promise.reject(new Error('音色不存在，请选择晴岚、灵汐、晚宁或星舟。'));
    const job = queue.then(async () => {
      await ensure();
      if (!existsSync(join(ROOT, 'voices', `${preset.id}.breeze`))) throw new Error(`音色 ${preset.name} 尚未建好，不会临时换成其他声音。`);
      const r = await fetch(`${BASE}/v1/audio/speech`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: text, voice: preset.id, response_format: 'pcm', seed: preset.seed, cfg_scale: 1, split_chars: 120, max_new_tokens: 750 }),
        signal: AbortSignal.timeout(180000),
      });
      if (!r.ok) throw new Error(`Breeze 合成失败（HTTP ${r.status}）。`);
      if (!r.headers.get('content-type')?.startsWith('audio/pcm')) throw new Error('Breeze 返回的不是预期音频。');
      const pcm = Buffer.from(await r.arrayBuffer());
      mkdirSync(outputDir, { recursive: true });
      const file = join(outputDir, `${preset.id}-${randomUUID()}.wav`);
      writeFileSync(file, wavBuffer(pcm), { flag: 'wx' });
      return { file, engine: 'breeze-tts2-vulkan', voice: preset.id };
    });
    queue = job.catch(() => {});
    return job;
  }
  function convert(source, voiceValue, {text='',keepMelody=0,outputDir=join(ROOT,'samples')}={}) {
    const preset=presetOf(voiceValue);
    if(!preset)return Promise.reject(new Error('音色不存在。'));
    if(!Number.isInteger(keepMelody)||keepMelody<0||keepMelody>2)return Promise.reject(new Error('保留旋律只能是 0、1 或 2。'));
    const job=queue.then(async()=>{
      const {audio,seconds}=readSourceWav(source,options.sourceRoots);
      await ensure();
      const form=new FormData();form.set('source',new Blob([audio],{type:'audio/wav'}),'vocal.wav');form.set('voice_id',preset.id);
      form.set('temperature','0.3');form.set('top_k','1');form.set('keep_acoustic',String(keepMelody));form.set('seed',String(preset.seed));
      if(text)form.set('text',validateText(text));
      const r=await fetch(`${BASE}/v1/audio/convert`,{method:'POST',body:form,signal:AbortSignal.timeout(900000)});
      if(!r.ok||!r.headers.get('content-type')?.startsWith('audio/pcm'))throw new Error(`实验换声失败（HTTP ${r.status}）。`);
      const pcm=Buffer.from(await r.arrayBuffer());
      mkdirSync(outputDir,{recursive:true});const file=join(outputDir,`experimental-${preset.id}-${randomUUID()}.wav`);
      writeFileSync(file,wavBuffer(pcm),{flag:'wx'});
      return {file,voice:preset.id,engine:'breeze-experimental-conversion',sourceSeconds:seconds,seconds:pcm.length/48000,warning:'实验功能可能改变音高或旋律；没有替换原有 RVC 翻唱。'};
    });
    queue=job.catch(()=>{});return job;
  }
  return { ensure, synth, convert, health:checkHealth };
}
