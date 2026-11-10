import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {normalizeSpeech} from '../assets/breeze-voice/loudness.mjs';
import {wavBuffer} from '../assets/breeze-voice/service.mjs';
const root=mkdtempSync(join(tmpdir(),'dafeiyu-loudness-'));
const ffmpeg=process.env.DSH_TEST_FFMPEG;
test('normalization requires an explicit executable and never overwrites output',async()=>{
 const input=join(root,'input.wav'),output=join(root,'keep.wav');writeFileSync(input,wavBuffer(Buffer.alloc(48000)));writeFileSync(output,'keep this file');
 await assert.rejects(normalizeSpeech(input,join(root,'unused.wav'),undefined),/FFmpeg/);
 await assert.rejects(normalizeSpeech(input,output,process.execPath),/独立输出/);assert.equal(readFileSync(output,'utf8'),'keep this file');
});
test('real FFmpeg normalizes valid audio without clipping or modifying its input',{skip:!ffmpeg},async()=>{
 const pcm=Buffer.alloc(48000*4);for(let i=0;i<pcm.length/2;i++)pcm.writeInt16LE(Math.round(1800*Math.sin(2*Math.PI*440*i/24000)),i*2);
 const input=join(root,'quiet.wav'),output=join(root,'normal.wav'),original=wavBuffer(pcm);writeFileSync(input,original);
 const result=await normalizeSpeech(input,output,ffmpeg);assert(Number.isFinite(result.outputLufs));assert(result.outputTruePeakDb<=-1);assert(existsSync(output));assert(readFileSync(input).equals(original));assert(!readdirSync(root).some(n=>n.startsWith('.loudness-')));
});
test('silent or failed processing cannot publish junk or delete source files',{skip:!ffmpeg},async()=>{
 const input=join(root,'silence.wav'),output=join(root,'never.wav');writeFileSync(input,wavBuffer(Buffer.alloc(48000*4)));
 await assert.rejects(normalizeSpeech(input,output,ffmpeg),/失败/);assert(existsSync(input));assert(!existsSync(output));assert(!readdirSync(root).some(n=>n.startsWith('.loudness-')));
});
