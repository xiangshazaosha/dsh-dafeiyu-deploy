// Run only on a user-authorized local vocal; no QQ or network callbacks.
import {existsSync,statSync,mkdirSync,writeFileSync,copyFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
const args=process.argv.slice(2),get=k=>args[args.indexOf(k)+1];
for(const k of ['--plugin-dir','--root','--input','--output','--voices'])if(!args.includes(k)||!get(k))throw Error('Required: --plugin-dir --root --input --output --voices id1,id2; optional --seconds 10 --check-only');
const plugin=resolve(get('--plugin-dir')),root=resolve(get('--root')),input=resolve(get('--input')),out=resolve(get('--output'));
const seconds=args.includes('--seconds')?Number(get('--seconds')):10;
if(!Number.isInteger(seconds)||seconds<1||seconds>20)throw Error('Short acceptance tests accept 1-20 seconds');
if(!statSync(input).isFile())throw Error('Input must be a local vocal file');
if(existsSync(out))throw Error('Choose a new output directory; preserve old samples');
const {createSongStudio,listVoices}=await import(pathToFileURL(join(plugin,'src/song/studio.js')));
const ids=get('--voices').split(','),voices=listVoices(join(root,'models'));
for(const id of ids)if(!voices.some(v=>v.id===id))throw Error('Requested voice is not installed: '+id);
if(args.includes('--check-only')){console.log(JSON.stringify({checked:true,voices:ids,seconds,qqSent:false}));process.exit(0);}
mkdirSync(out,{recursive:true});
const ffmpeg=join(root,'bin/ffmpeg.exe'),source=join(out,'input-short.wav');
const run=(command,params)=>{const r=spawnSync(command,params,{encoding:'utf8',windowsHide:true});if(r.status!==0)throw Error(r.stderr);return r;};
run(ffmpeg,['-n','-hide_banner','-loglevel','error','-i',input,'-t',String(seconds),'-ar','44100','-ac','1',source]);
const config={song:{enabled:true,root,voice:ids[0],pitch:0,maxVoiceSec:seconds,clipStart:'head',keepWork:true,ownerOnly:true},local:{song:false}};
const log={info:()=>{},warn:()=>{},debug:()=>{},error:()=>{}};
const studio=createSongStudio({getConfig:()=>config,log,sendVoiceFile:async()=>{throw Error('QQ send forbidden')},sendText:async()=>{throw Error('QQ send forbidden')}});
const results=[];
for(const voice of ids){
 const start=Date.now();
 try{
  const file=await studio.convertSpeech(source,{voice,pitch:0,outDir:join(out,voice)});
  const check=run(ffmpeg,['-hide_banner','-i',file,'-af','volumedetect','-f','null','-']);
  if(!/mean_volume: (?!-inf)[-\d.]+ dB/.test(check.stderr))throw Error('Audio is silent or invalid');
  const target=join(out,voice+'.wav');copyFileSync(file,target);
  results.push({voice,ok:true,seconds:(Date.now()-start)/1000,file:target,hasIndex:!!voices.find(v=>v.id===voice).index});
 }catch(e){results.push({voice,ok:false,error:String(e)});}
 writeFileSync(join(out,'results.json'),JSON.stringify(results,null,2));
}
console.log(JSON.stringify({results,qqSent:false}));if(results.some(r=>!r.ok))process.exitCode=1;
