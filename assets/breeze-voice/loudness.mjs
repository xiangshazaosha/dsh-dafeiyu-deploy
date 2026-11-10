import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {isAbsolute,resolve,dirname,join} from 'node:path';
import {existsSync,statSync,unlinkSync,writeFileSync,linkSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const run=promisify(execFile);
function parse(log){const blocks=log.match(/\{[^{}]*"input_i"[^{}]*\}/gs);if(!blocks?.length)throw Error('未取得响度测量结果。');const m=JSON.parse(blocks.at(-1));for(const k of ['input_i','input_tp','input_lra','input_thresh','target_offset'])if(!Number.isFinite(Number(m[k])))throw Error('音频响度无效，未输出替代声音。');return m;}
// Only explicit presets opt in; this does not alter the other installed voices.
export async function normalizeSpeech(input,output,ffmpeg){
 if(typeof ffmpeg!=='string'||!isAbsolute(ffmpeg)||!existsSync(ffmpeg)||!statSync(ffmpeg).isFile())throw Error('文字V2音色需要配置已核对的 FFmpeg 路径以统一音量。');
 if(!isAbsolute(input)||!isAbsolute(output)||resolve(input)===resolve(output)||existsSync(output))throw Error('响度处理须使用新的独立输出文件。');
 const options={windowsHide:true,timeout:120000,maxBuffer:1024*1024,encoding:'utf8'};let work;
 try{
  const first=await run(ffmpeg,['-hide_banner','-nostats','-i',input,'-af','loudnorm=I=-16:TP=-1.5:LRA=9:print_format=json','-f','null','-'],options);const m=parse(first.stderr);
  const filter=`loudnorm=I=-16:TP=-1.5:LRA=9:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true:print_format=json`;
  const pending=join(dirname(output),'.loudness-'+randomUUID()+'.wav');writeFileSync(pending,Buffer.alloc(0),{flag:'wx'});work=pending;
  const rendered=await run(ffmpeg,['-hide_banner','-nostats','-i',input,'-af',filter,'-ar','24000','-ac','1','-c:a','pcm_s16le','-y',work],options);const measured=parse(rendered.stderr);
  if(!existsSync(work)||statSync(work).size<2400||!Number.isFinite(Number(measured.output_i))||!Number.isFinite(Number(measured.output_tp))||Number(measured.output_tp)>-0.5)throw Error('响度输出检查未通过。');
  linkSync(work,output);
  return {targetLufs:-16,truePeakLimitDb:-1.5,outputLufs:Number(measured.output_i),outputTruePeakDb:Number(measured.output_tp)};
 }catch(error){throw Error('本机语音音量统一失败；未切换其他声音。');}finally{if(work&&existsSync(work))unlinkSync(work);}
}
