// Sharing audit: source + explicitly approved synthetic presets only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync,lstatSync,existsSync} from 'node:fs';
import {join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
const approved=new Set(['feiye','lanyangyang_style','aojiao_daxiaojie','mihu_nvdaxuesheng','badao_nvzongcai','nan_gaozhongsheng','nan_daxuesheng','aojiao_text_v2','sajiao_text_v2','wenrou_text_v2','taiwan_text_v2'].map(x=>x+'.breeze'));
function files(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>{const p=join(dir,e.name);assert(!lstatSync(p).isSymbolicLink(),'No linked deployment payloads');return e.isDirectory()?files(p):[p];});}
test('assets contain no user media, runtime state, private weights or undeclared voices',()=>{
 const all=files(join(root,'assets')),presets=all.filter(f=>f.endsWith('.breeze'));
 assert.equal(presets.length,approved.size);
 for(const f of all){const rel=relative(join(root,'assets'),f).replaceAll('\\','/');
  if(f.endsWith('.breeze'))assert(approved.has(rel.replace(/^breeze-presets\//,'')));
  else assert(!/\.(?:wav|mp3|m4a|mp4|flac|aac|opus|ogg|png|jpg|exe|dll|gguf|ckpt|pth|onnx)$/i.test(f),rel);
  assert(!/(?:^|\/)(?:config|jobs|qq-requests|local-sources|source-folders|validated-stems|歌曲库索引|napcat-connection[^/]*|onebot11[^/]*|webui)\.json$/i.test(rel),rel);
 }
 const manifest=JSON.parse(readFileSync(join(root,'assets/breeze-presets/manifest.json'),'utf8'));
 assert.equal(manifest.voices.length,approved.size);
 for(const v of manifest.voices){assert(approved.has(v.file));assert.equal(createHash('sha256').update(readFileSync(join(root,'assets/breeze-presets',v.file))).digest('hex'),v.sha256);}
});

test('NapCat deployment replaces obsolete gateway payloads without redistributing gateway binaries',()=>{
 for(const rel of ['references/snowluma-setup-and-reuse.md','scripts/find-snowluma.ps1','scripts/patch-aurabot-attach.py','scripts/test-qq-attach-guard.mjs','assets/qq-attach-guard.mjs'])assert(!existsSync(join(root,rel)),rel);
 for(const rel of ['references/napcat-deployment.md','scripts/prepare-napcat.mjs','scripts/test-napcat-deploy.mjs','scripts/repair-qq-gateway.ps1','scripts/test-repair-qq-gateway.ps1'])assert(existsSync(join(root,rel)),rel);
 const source=['scripts/prepare-napcat.mjs','scripts/repair-qq-gateway.ps1'].map(rel=>readFileSync(join(root,rel),'utf8')).join('\n');assert(!/\/snowluma\/|src[\\/]snowluma/.test(source));
});
test('public controls exclude local-only rotation and new cover dependencies are present',()=>{
 const controls=['index.mjs','panel.js'].map(n=>readFileSync(join(root,'assets/voice-controls',n),'utf8')).join('\n');
 assert(!/breezeRotation|speech\.rotation|女声轮换/.test(controls));
 for(const n of ['qq-router.mjs','local-sources.mjs','folder-library.mjs','saved-profile.mjs'])assert(readFileSync(join(root,'assets/breeze-cover',n)).length>0);
});
