// Copy only selected, reviewed user-module source; never touch config or vendor code.
import {readFileSync,existsSync,mkdirSync,copyFileSync,renameSync,lstatSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {readRuntime} from '../assets/breeze-voice/service.mjs';

export function install({pluginDir,dataDir,module,apply=false,replace=false,backupDir}){
  if(!['breeze-voice','voice-controls'].includes(module))throw Error('Select breeze-voice or voice-controls');
  const plugin=resolve(pluginDir),data=resolve(dataDir);
  const api=readFileSync(join(plugin,'src/core/modules.js'),'utf8');
  if(!api.includes('API_VERSION = 1')||!api.includes('setConfig:')||!api.includes('route:'))throw Error('Module API contract changed; review before installation');
  const pkg=JSON.parse(readFileSync(join(plugin,'package.json'),'utf8'));
  const id=module==='breeze-voice'?'voice':module;
  if(module==='breeze-voice'){
    const builtin=readFileSync(join(plugin,'src/modules/voice/index.js'),'utf8');
    if(!builtin.includes('setup(api)')||!builtin.includes("api.route('/voice/test'"))throw Error('Voice integration contract changed');
    const cfg=JSON.parse(readFileSync(join(data,'config.json'),'utf8'));
    readRuntime(cfg.ext?.voice?.breezeRoot);
  }
  const source=fileURLToPath(new URL('../assets/'+module+'/',import.meta.url));
  const names=module==='breeze-voice'?['service.mjs','index.mjs']:['panel.js','index.mjs'];
  const target=join(data,'modules',id);
  if(existsSync(target)&&lstatSync(target).isSymbolicLink())throw Error('Refusing to replace a linked module directory');
  const changed=names.filter(n=>!existsSync(join(target,n))||!readFileSync(join(target,n)).equals(readFileSync(join(source,n))));
  const overwrites=changed.filter(n=>existsSync(join(target,n)));
  for(const n of names){
    const src=readFileSync(join(source,n),'utf8');
    if(n==='panel.js')new Function('React','h','ui','call',src);
    else {const p=spawnSync(process.execPath,['--check',join(source,n)],{encoding:'utf8',windowsHide:true});if(p.status!==0)throw Error(p.stderr);}
  }
  if(apply&&overwrites.length&&(!replace||!backupDir))throw Error('Existing custom source differs; review, then supply --replace and a new --backup-dir');
  if(!apply)return {apply:false,id,pluginVersion:pkg.version,changed,overwrites,configurationChanged:false};
  if(overwrites.length){
    const backup=resolve(backupDir);
    if(existsSync(backup))throw Error('Backup directory already exists');
    if(backup===target||backup.startsWith(target+'/')||backup.startsWith(target+'\\'))throw Error('Backup must be outside the module');
    mkdirSync(backup,{recursive:true});
    for(const n of overwrites)copyFileSync(join(target,n),join(backup,n));
  }
  mkdirSync(target,{recursive:true});
  // Entry last; the host reloads the module from a snapshot.
  for(const n of changed){
    const next=join(target,n+'.deploy-new');
    if(existsSync(next))throw Error('A pending deployment file exists; review it first');
    copyFileSync(join(source,n),next);
    renameSync(next,join(target,n));
  }
  return {apply:true,id,pluginVersion:pkg.version,changed,configurationChanged:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),get=k=>args[args.indexOf(k)+1];
  if(!args.includes('--plugin-dir')||!args.includes('--data-dir')||!args.includes('--module'))throw Error('Required: --plugin-dir --data-dir --module; default is check-only');
  console.log(JSON.stringify(install({pluginDir:get('--plugin-dir'),dataDir:get('--data-dir'),module:get('--module'),apply:args.includes('--apply'),replace:args.includes('--replace'),backupDir:args.includes('--backup-dir')?get('--backup-dir'):undefined})));
}
