import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync,readdirSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {readPack,installPresets} from './install-breeze-presets.mjs';
import {loadPresets,createService} from '../assets/breeze-voice/service.mjs';
import wrapper from '../assets/breeze-voice/index.mjs';
const temp=()=>mkdtempSync(join(tmpdir(),'dafeiyu-fixed-presets-'));
const config=JSON.stringify({private:'not-a-real-secret',speech:'keep',rvc:'keep',replyMode:'text'});
test('nine real saved presets have exact checksums and model attribution',()=>{
 const pack=readPack();assert.equal(pack.voices.length,9);
 assert.deepEqual(pack.voices.map(x=>x.preset.id),['jiaojiao','feiye','lanyangyang_style','taiwan_jutian','aojiao_daxiaojie','mihu_nvdaxuesheng','badao_nvzongcai','nan_gaozhongsheng','nan_daxuesheng']);
 assert.equal(pack.voices.find(x=>x.characterApproximation).preset.id,'lanyangyang_style');
 assert(pack.voices.every(x=>x.synthetic&&!x.officialPreset));
 assert(!pack.voices.some(x=>['rexue_dongmanshaonv','luoli_keai'].includes(x.preset.id)));
});
test('check-only is read-only; explicit selected import is repeatable and preserves config',()=>{
 const root=temp();writeFileSync(join(root,'config.json'),config);
 const preflight=installPresets({root,voices:['jiaojiao']});assert.equal(preflight.apply,false);assert.equal(existsSync(join(root,'voices')),false);
 assert.throws(()=>installPresets({root,apply:true}),/non-commercial/);assert.equal(existsSync(join(root,'voices')),false);
 const first=installPresets({root,voices:['jiaojiao'],apply:true,nonCommercial:true});assert.deepEqual(first.newFiles,['jiaojiao.breeze']);
 assert.equal(loadPresets(root).length,5);assert(!existsSync(join(root,'voices/feiye.breeze')));
 const second=installPresets({root,voices:['jiaojiao'],apply:true,nonCommercial:true});assert.deepEqual(second.newFiles,[]);assert.equal(second.metadataChanged,false);
 assert.equal(readFileSync(join(root,'config.json'),'utf8'),config);
 assert(existsSync(join(root,'licenses/dafeiyu-breeze-presets/BREEZEBLUE-LICENSE.txt')));
});
test('merges selected voices, backs up metadata, and never changes existing entries',()=>{
 const root=temp();installPresets({root,voices:['jiaojiao'],apply:true,nonCommercial:true});const old=readFileSync(join(root,'voices/custom-presets.json'));
 const result=installPresets({root,voices:['feiye'],apply:true,nonCommercial:true});
 assert.equal(loadPresets(root).length,6);assert(readFileSync(join(result.backup,'custom-presets.json')).equals(old));
 assert.deepEqual(JSON.parse(readFileSync(join(root,'voices/custom-presets.json'))).map(x=>x.id),['jiaojiao','feiye']);
});
test('unselected private presets and their files survive an import unchanged',()=>{
 const root=temp();mkdirSync(join(root,'voices'));
 const personal={id:'local_only',name:'Unshared local voice',description:'Keep local',instruction:'Local direction',direction:'Local direction',seed:90};
 writeFileSync(join(root,'voices/local_only.breeze'),'private test fixture');writeFileSync(join(root,'voices/custom-presets.json'),JSON.stringify([personal]));
 installPresets({root,voices:['aojiao_daxiaojie'],apply:true,nonCommercial:true});
 const list=JSON.parse(readFileSync(join(root,'voices/custom-presets.json')));assert.deepEqual(list[0],personal);assert.equal(list.length,2);
 assert.equal(readFileSync(join(root,'voices/local_only.breeze'),'utf8'),'private test fixture');assert(!readPack().voices.some(x=>x.preset.id==='local_only'));
});
test('conflicting voice/metadata and lock fail without clobbering or partial selection',()=>{
 const root=temp();mkdirSync(join(root,'voices'));writeFileSync(join(root,'voices/feiye.breeze'),'existing unrelated voice');
 assert.throws(()=>installPresets({root,apply:true,nonCommercial:true}),/refusing to overwrite/);
 assert(!existsSync(join(root,'voices/jiaojiao.breeze')));assert.equal(readFileSync(join(root,'voices/feiye.breeze'),'utf8'),'existing unrelated voice');
 const other=temp();installPresets({root:other,voices:['jiaojiao'],apply:true,nonCommercial:true});
 const file=join(other,'voices/custom-presets.json'),list=JSON.parse(readFileSync(file));list[0].direction='Keep my custom delivery';writeFileSync(file,JSON.stringify(list));
 assert.throws(()=>installPresets({root:other,voices:['jiaojiao'],apply:true,nonCommercial:true}),/preset differs/);
 const locked=temp();writeFileSync(join(locked,'.breeze-presets-install.lock'),'another installer');assert.throws(()=>installPresets({root:locked,apply:true,nonCommercial:true}));assert(!existsSync(join(locked,'voices')));
});
test('bundle corruption, unrecognized IDs and traversal are rejected',()=>{
 const pack=temp(),source=fileURLToPath(new URL('../assets/breeze-presets/',import.meta.url));
 for(const name of readdirSync(source))copyFileSync(join(source,name),join(pack,name));
 const original=readFileSync(join(pack,'manifest.json'));writeFileSync(join(pack,'jiaojiao.breeze'),'corrupt');assert.throws(()=>readPack(pack),/checksum/);
 const manifest=JSON.parse(original);manifest.voices[0].file='../escape.breeze';writeFileSync(join(pack,'manifest.json'),JSON.stringify(manifest));assert.throws(()=>readPack(pack),/Invalid/);
 assert.throws(()=>installPresets({root:temp(),voices:['../escape']}),/Select/);
});
test('runtime lists are root-specific and update without busting sibling ESM caches',()=>{
 const first=temp(),second=temp();assert.equal(loadPresets(first).length,4);
 installPresets({root:first,voices:['taiwan_jutian'],apply:true,nonCommercial:true});
 assert.equal(loadPresets(first).length,5);assert.equal(loadPresets(second).length,4);
 const file=join(first,'voices/custom-presets.json'),list=JSON.parse(readFileSync(file));list[0].name='My renamed Taiwan Mandarin';writeFileSync(file,JSON.stringify(list));
 assert.equal(loadPresets(first).at(-1).name,'My renamed Taiwan Mandarin');
 list[0].id='../escape';writeFileSync(file,JSON.stringify(list));assert.throws(()=>loadPresets(first),/不合法/);
});
test('wrapper dynamically lists/selects imported voices while preserving legacy speech opt-out',async()=>{
 const root=temp();let settings={breezeRoot:root,breezeVoice:'qinglan',breezeEnabled:false};
 writeFileSync(join(root,'breeze-runtime.json'),JSON.stringify({exe:'runtime/server.exe',model:'models/model.gguf'}));
 const commands=new Map();const api={settings:()=>settings,saveSettings:p=>Object.assign(settings,p),log:{},onDispose:()=>{},lib:()=>({default:{setup:()=>({speak:async()=>({engine:'legacy'})})}}),route:()=>{},command:c=>commands.set(c.name,c),dataDir:()=>root};
 const module=wrapper.setup(api);assert.equal(module.breezeVoices().length,4);
 installPresets({root,voices:['taiwan_jutian'],apply:true,nonCommercial:true});assert.equal(module.breezeVoices().length,5);
 commands.get('音色').run('台湾女生·巨甜普通话');assert.equal(settings.breezeVoice,'taiwan_jutian');assert.equal((await module.speak('测试')).engine,'legacy');
});
test('real service request retains fixed voice plus direction; original presets keep cfg=1',async()=>{
 const root=temp();installPresets({root,apply:true,nonCommercial:true});writeFileSync(join(root,'voices/qinglan.breeze'),'test fixture');
 const received=[];const server=createServer(async(req,res)=>{
  if(req.url==='/health'){res.setHeader('content-type','application/json');res.end(JSON.stringify({status:'ok',sample_rate:24000}));return;}
  let body='';for await(const part of req)body+=part;received.push(JSON.parse(body));res.setHeader('content-type','audio/pcm');res.end(Buffer.alloc(4800));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let dispose;
 try{
  const service=createService({runtime:{root,port:server.address().port,exe:'server.exe',model:'model.gguf'},onDispose:fn=>dispose=fn});
  await service.synth('台湾女生讲普通话，声音巨甜。','taiwan_jutian');await service.synth('保持原来的声音。','qinglan');
  assert.equal(received[0].voice,'taiwan_jutian');assert.equal(received[0].cfg_scale,4);assert(received[0].instructions.includes('台湾'));
  assert.equal(received[1].cfg_scale,1);assert.equal(received[1].instructions,undefined);
 }finally{dispose?.();await new Promise(r=>server.close(r));}
});
