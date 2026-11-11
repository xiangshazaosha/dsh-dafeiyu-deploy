import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {install} from './install-voice-module.mjs';
test('preflight, install, no-clobber, backup and configuration preservation',()=>{
 const root=mkdtempSync(join(tmpdir(),'dafeiyu-installer-test-')),plugin=join(root,'plugin'),data=join(root,'data');
 mkdirSync(join(plugin,'src/core'),{recursive:true});mkdirSync(data);
 writeFileSync(join(plugin,'src/core/modules.js'),'API_VERSION = 1; setConfig: route:');writeFileSync(join(plugin,'package.json'),JSON.stringify({version:'test-fixture'}));
 const config='{"private":"keep-local"}';writeFileSync(join(data,'config.json'),config);
 const args={pluginDir:plugin,dataDir:data,module:'voice-controls'};
 assert.equal(install(args).apply,false);assert.equal(existsSync(join(data,'modules')),false);
 assert.equal(install({...args,apply:true}).apply,true);
 const target=join(data,'modules/voice-controls/index.mjs');writeFileSync(target,'// existing custom module');
 assert.throws(()=>install({...args,apply:true}));
 const backup=join(root,'backup');install({...args,apply:true,replace:true,backupDir:backup});
 assert.equal(readFileSync(join(backup,'index.mjs'),'utf8'),'// existing custom module');assert.equal(readFileSync(join(data,'config.json'),'utf8'),config);
 assert.throws(()=>install({...args,module:'unknown'}));
});
test('cover and song-library install reviewed source only, enforce prerequisites and preserve private settings',()=>{
 const root=mkdtempSync(join(tmpdir(),'dafeiyu-cover-installer-')),plugin=join(root,'plugin'),data=join(root,'data'),rvc=join(root,'rvc');
 mkdirSync(join(plugin,'src/core'),{recursive:true});mkdirSync(join(plugin,'src/song'),{recursive:true});mkdirSync(data);
 writeFileSync(join(plugin,'src/core/modules.js'),'API_VERSION = 1; setConfig: route: tool: rule: onDispose: command: every: on:');writeFileSync(join(plugin,'package.json'),JSON.stringify({version:'fixture'}));writeFileSync(join(plugin,'src/song/studio.js'),'convertSpeech search request');
 const cfg={private:'keep-local',song:{root:rvc,separatorModel:'fixture.ckpt'},ext:{voice:{breezeVoice:'keep-current'},'voice-controls':{replyMode:'voice'}}};const config=JSON.stringify(cfg);writeFileSync(join(data,'config.json'),config);
 const args={pluginDir:plugin,dataDir:data,module:'breeze-cover'};
 assert.throws(()=>install(args),/incomplete/);assert.equal(existsSync(join(data,'modules')),false);
 for(const p of ['bin/ffmpeg.exe','env/Scripts/python.exe','separator-models/fixture.ckpt','separator-models/fixture.yaml']){const file=join(rvc,p);mkdirSync(file.substring(0,Math.max(file.lastIndexOf('/'),file.lastIndexOf('\\'))),{recursive:true});writeFileSync(file,'fixture');}
 assert.deepEqual(install(args).changed,['separate.py','studio.mjs','saved-profile.mjs','local-sources.mjs','folder-library.mjs','qq-router.mjs','panel.js','index.mjs']);assert.equal(existsSync(join(data,'modules')),false);
 install({...args,apply:true});assert.equal(existsSync(join(data,'modules/breeze-cover/separate.py')),true);assert.equal(readFileSync(join(data,'config.json'),'utf8'),config);assert.deepEqual(install(args).changed,[]);
 const target=join(data,'modules/breeze-cover/index.mjs');writeFileSync(target,'// customized');assert.throws(()=>install({...args,apply:true}));const backup=join(root,'backup');install({...args,apply:true,replace:true,backupDir:backup});assert.equal(readFileSync(join(backup,'index.mjs'),'utf8'),'// customized');
 const library=install({...args,module:'song-library',apply:true});assert.equal(library.id,'song-library');assert.equal(library.changed.length,5);assert.equal(readFileSync(join(data,'config.json'),'utf8'),config);
});
