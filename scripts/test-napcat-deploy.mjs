// Isolated filesystem fixtures only. No gateway, network, account or model use.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {prepareNapcat} from './prepare-napcat.mjs';
const script=fileURLToPath(new URL('./prepare-napcat.mjs',import.meta.url));
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'napcat-skill-')),configDir=join(root,'config');mkdirSync(configDir);
 const opts={configDir,connectionFile:join(root,'napcat-connection.json'),botQQ:'11111',ownerQQ:'22222',httpPort:13000,wsPort:13001},account=join(configDir,'onebot11_11111.json');
 t.after(async()=>{assert(resolve(root).startsWith(resolve(tmpdir())+sep+'napcat-skill-'));for(let i=0;i<4;i++)try{rmSync(root,{recursive:true,force:true});break;}catch(e){if(i===3)throw e;await new Promise(r=>setTimeout(r,50*(i+1)));}});
 return {root,opts,account};
}
test('default inspection neither creates files nor exposes accounts or credentials',t=>{
 const f=fixture(t),r=prepareNapcat(f.opts);assert.equal(r.filesChanged,0);assert.equal(r.applied,false);assert.deepEqual(readdirSync(f.opts.configDir),[]);assert.deepEqual(readdirSync(f.root),['config']);assert(!JSON.stringify(r).includes(f.opts.botQQ));
});
test('apply creates account-specific loopback services and an independent private connection patch',t=>{
 const f=fixture(t),r=prepareNapcat({...f.opts,apply:true}),cfg=JSON.parse(readFileSync(f.account)),patch=JSON.parse(readFileSync(f.opts.connectionFile)),http=cfg.network.httpServers[0],ws=cfg.network.websocketServers[0];
 assert.equal(r.filesChanged,2);assert.equal(http.host,'127.0.0.1');assert.equal(ws.host,'127.0.0.1');assert.equal(http.port,13000);assert.equal(ws.port,13001);assert.equal(http.messagePostFormat,'array');assert.equal(ws.reportSelfMessage,false);assert.match(http.token,/^[a-f0-9]{64}$/);assert.equal(ws.token,http.token);
 assert.deepEqual(cfg.network.httpClients,[]);assert.deepEqual(cfg.network.websocketClients,[]);assert.equal(patch.gateway,'onebot');assert.equal(patch.snowluma.httpToken,http.token);assert.equal(patch.snowluma.wsToken,http.token);assert.equal(patch.snowluma.autoStart,false);assert.equal(patch.snowluma.autoAttach,false);assert.deepEqual(Object.keys(patch).sort(),['gateway','snowluma']);assert.equal(r.qqStarted,false);assert.equal(r.dshChanged,false);assert(!JSON.stringify(r).includes(http.token));
});
test('identical repeats preserve tokens and files byte-for-byte',t=>{
 const f=fixture(t);prepareNapcat({...f.opts,apply:true});const a=readFileSync(f.account),b=readFileSync(f.opts.connectionFile);assert.equal(prepareNapcat({...f.opts,apply:true}).reused,true);assert.deepEqual(readFileSync(f.account),a);assert.deepEqual(readFileSync(f.opts.connectionFile),b);
});
test('changed or unrelated existing configuration is never overwritten',t=>{
 const f=fixture(t);prepareNapcat({...f.opts,apply:true});const old=readFileSync(f.account);assert.throws(()=>prepareNapcat({...f.opts,apply:true,httpPort:14000}),/differs/);assert.deepEqual(readFileSync(f.account),old);
 const cfg=JSON.parse(old);cfg.customKeep=true;writeFileSync(f.account,JSON.stringify(cfg));const changed=readFileSync(f.account);assert.throws(()=>prepareNapcat({...f.opts,apply:true}),/differs/);assert.deepEqual(readFileSync(f.account),changed);
});
test('partial installations are preserved for review instead of resetting credentials',t=>{
 const f=fixture(t);writeFileSync(f.account,'{"existing":true}');assert.throws(()=>prepareNapcat({...f.opts,apply:true}),/Partial/);assert.deepEqual(readdirSync(f.root),['config']);assert.equal(readFileSync(f.account,'utf8'),'{"existing":true}');
});
test('same account, invalid ports and relative paths cannot create a deployment',t=>{
 const f=fixture(t);for(const p of [{ownerQQ:'11111'},{httpPort:13001},{httpPort:80},{wsPort:65536},{botQQ:'../escape'},{configDir:'relative'},{connectionFile:'relative.json'}])assert.throws(()=>prepareNapcat({...f.opts,...p,apply:true}));assert.deepEqual(readdirSync(f.opts.configDir),[]);
});
test('runtime credentials cannot be emitted inside the shareable skill',t=>{
 const f=fixture(t),shared=fileURLToPath(new URL('../assets/',import.meta.url));assert.throws(()=>prepareNapcat({...f.opts,configDir:shared,apply:true}),/outside/);assert.throws(()=>prepareNapcat({...f.opts,connectionFile:join(shared,'napcat-connection.json'),apply:true}),/outside/);assert.deepEqual(readdirSync(f.opts.configDir),[]);
});
test('CLI output remains credential-free and malformed options fail without mutation',t=>{
 const f=fixture(t);prepareNapcat({...f.opts,apply:true});const token=JSON.parse(readFileSync(f.account)).network.httpServers[0].token,args=['--config-dir',f.opts.configDir,'--connection-file',f.opts.connectionFile,'--bot-qq',f.opts.botQQ,'--owner-qq',f.opts.ownerQQ,'--http-port','13000','--ws-port','13001'];
 const good=spawnSync(process.execPath,[script,...args],{encoding:'utf8'});assert.equal(good.status,0);assert(!good.stdout.includes(token));assert(!good.stderr.includes(token));assert(JSON.parse(good.stdout).reused);
 const bad=spawnSync(process.execPath,[script,...args,'--http-port','bad'],{encoding:'utf8'});assert.equal(bad.status,1);assert(!bad.stderr.includes(token));
});
