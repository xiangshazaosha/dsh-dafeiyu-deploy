import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createService, readRuntime, PRESETS } from '../assets/breeze-voice/service.mjs';
const i=process.argv.indexOf('--root');
if(i<0||!process.argv[i+1])throw new Error('Required: --root with an already reviewed Breeze runtime');
const runtime=readRuntime(process.argv[i+1]),ROOT=runtime.root,BASE=runtime.base;

const cleanup = [];
const service = createService({ runtime, log: {info: console.log}, onDispose: fn => cleanup.push(fn) });
const text = '你好呀，我是大肥鱼。今天也想陪你聊聊天，听听音乐，把平凡的日子过得轻松又开心。';
const results = [];
try {
  await service.ensure();
  for (const p of PRESETS) {
    const sample = join(ROOT, 'samples', `${p.id}-reference.wav`);
    if (!existsSync(sample)) {
      const t = performance.now();
      const r = await fetch(`${BASE}/v1/audio/speech`, {
        method: 'POST', headers: {'content-type':'application/json'},
        body: JSON.stringify({input:text, instructions:p.instruction, response_format:'pcm', seed:p.seed, cfg_scale:1, max_new_tokens:250}),
        signal:AbortSignal.timeout(240000),
      });
      if(!r.ok || !r.headers.get('content-type')?.startsWith('audio/pcm')) throw new Error(`Design failed: ${p.id} ${r.status}`);
      const pcm = Buffer.from(await r.arrayBuffer());
      if(pcm.length < 24000 || pcm.length%2) throw new Error('Invalid audio');
      const h=Buffer.alloc(44); h.write('RIFF'); h.writeUInt32LE(pcm.length+36,4); h.write('WAVEfmt ',8); h.writeUInt32LE(16,16); h.writeUInt16LE(1,20); h.writeUInt16LE(1,22); h.writeUInt32LE(24000,24); h.writeUInt32LE(48000,28); h.writeUInt16LE(2,32); h.writeUInt16LE(16,34); h.write('data',36); h.writeUInt32LE(pcm.length,40);
      writeFileSync(sample,Buffer.concat([h,pcm]),{flag:'wx'});
      const elapsedMs=performance.now()-t;
      results.push({voice:p.id,name:p.name,seconds:pcm.length/48000,elapsedMs,realtime:pcm.length/48000/(elapsedMs/1000)});
      console.log(JSON.stringify(results.at(-1)));
    }
    if(!existsSync(join(ROOT,'voices',`${p.id}.breeze`))) {
      const {readFileSync}=await import('node:fs');
      const f=new FormData(); f.set('ref_audio',new Blob([readFileSync(sample)],{type:'audio/wav'}),`${p.id}.wav`); f.set('ref_text',text); f.set('name',p.id); f.set('description',`${p.name}：${p.description}（Breeze原创设计音色，非真人克隆）`); f.set('metadata',JSON.stringify({source:'Breeze TTS 2 voice design',language:'zh-CN',synthetic:'true'}));
      const r=await fetch(`${BASE}/v1/voices`,{method:'POST',body:f,signal:AbortSignal.timeout(120000)});
      if(!r.ok)throw new Error(`Save voice failed: ${p.id} ${r.status} ${await r.text()}`);
      console.log('Saved voice:',(await r.json()).id);
    }
  }
  writeFileSync(join(ROOT,'samples','voice-design-results-'+Date.now()+'.json'),JSON.stringify(results,null,2));
  console.log('ALL_ORIGINAL_VOICES_READY');
} finally { for(const fn of cleanup)fn(); }
