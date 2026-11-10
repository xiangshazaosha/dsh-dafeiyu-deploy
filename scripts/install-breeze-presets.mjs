// Offline, no-clobber import of explicitly selected saved synthetic presets.
import {readFileSync,existsSync,mkdirSync,copyFileSync,writeFileSync,renameSync,linkSync,unlinkSync,openSync,closeSync,lstatSync,realpathSync,constants} from 'node:fs';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {PRESETS,loadPresets} from '../assets/breeze-voice/service.mjs';
const bundled=fileURLToPath(new URL('../assets/breeze-presets/',import.meta.url));
const sha=b=>createHash('sha256').update(b).digest('hex');
const same=(a,b)=>['id','name','description','instruction','direction','seed','normalizeOutput'].every(k=>a[k]===b[k]);
const inside=(root,path)=>{const r=relative(root,path);return !r.startsWith('..')&&!isAbsolute(r);};
export function readPack(packDir=bundled){
  const pack=resolve(packDir),manifest=JSON.parse(readFileSync(join(pack,'manifest.json'),'utf8'));
  if(manifest.schema!==1||!Array.isArray(manifest.voices)||!manifest.voices.length||manifest.voices.length>32||manifest.licenseFile!=='BREEZEBLUE-LICENSE.txt')throw Error('Unrecognized preset pack');
  if(sha(readFileSync(join(pack,manifest.licenseFile)))!==manifest.licenseSha256)throw Error('Preset license checksum mismatch');
  if(!existsSync(join(pack,'NOTICE')))throw Error('Preset attribution is missing');
  const ids=new Set(PRESETS.map(p=>p.id)),names=new Set(PRESETS.map(p=>p.name));
  for(const entry of manifest.voices){
    const p=entry.preset;
    if(!p||!/^[-a-z0-9_]{1,64}$/.test(p.id)||ids.has(p.id)||names.has(p.name)||entry.file!==p.id+'.breeze'||entry.synthetic!==true||typeof p.name!=='string'||!p.name.trim()||p.name.length>64||typeof p.description!=='string'||typeof p.instruction!=='string'||typeof p.direction!=='string'||!Number.isInteger(p.seed)||p.seed<0||p.seed>0xffffffff)throw Error('Invalid or duplicate preset definition');
    ids.add(p.id);names.add(p.name);
    if(p.normalizeOutput!==undefined&&typeof p.normalizeOutput!=='boolean')throw Error('Invalid normalization flag');
    if(p.displayOrder!==undefined&&(!Number.isInteger(p.displayOrder)||Math.abs(p.displayOrder)>10000))throw Error('Invalid display order');
    const file=join(pack,entry.file);
    if(lstatSync(file).isSymbolicLink())throw Error('Linked bundle voice is not allowed');
    const bytes=readFileSync(file);
    if(bytes.length!==entry.size||bytes.length<8||bytes.length>1024*1024||bytes.toString('ascii',0,4)!=='BRZV'||bytes.readUInt32LE(4)!==2||sha(bytes)!==entry.sha256)throw Error('Preset checksum or format mismatch: '+p.id);
  }
  return manifest;
}
export function installPresets({root,voices,apply=false,nonCommercial=false,packDir=bundled}){
  if(!root||!isAbsolute(root)||!existsSync(root))throw Error('Required: an existing absolute Breeze --root');
  const base=realpathSync(root),dir=join(base,'voices'),pack=readPack(packDir);
  if(existsSync(dir)&&(!inside(base,realpathSync(dir))||!lstatSync(dir).isDirectory()))throw Error('Voice directory must be a real directory inside the selected root');
  const selected=voices??pack.voices.map(x=>x.preset.id);
  if(!Array.isArray(selected)||!selected.length||new Set(selected).size!==selected.length||selected.some(id=>!pack.voices.some(x=>x.preset.id===id)))throw Error('Select unique voice IDs from the pack');
  const entries=pack.voices.filter(x=>selected.includes(x.preset.id));
  const metadata=join(dir,'custom-presets.json'),old=existsSync(metadata)?readFileSync(metadata):null;
  if(existsSync(metadata)&&lstatSync(metadata).isSymbolicLink())throw Error('Linked preset metadata is not allowed');
  const existing=old?JSON.parse(old.toString('utf8')):[];
  if(!Array.isArray(existing))throw Error('Existing preset list is not an array');
  // Validate existing runtime entries before merging; preserve every unselected entry.
  loadPresets(base);
  const merged=[...existing],files=[],presentationChanged=[];
  for(const entry of entries){
    const p=entry.preset,match=existing.find(x=>x.id===p.id);
    if(match&&!same(match,p))throw Error('Existing preset differs; refusing to overwrite: '+p.id);
    if(match&&['displayOrder'].some(k=>p[k]!==undefined&&p[k]!==match[k])){
      merged[merged.findIndex(x=>x.id===p.id)]={...match,...(p.displayOrder!==undefined?{displayOrder:p.displayOrder}:{})};presentationChanged.push(p.id);
    }
    if(!match&&existing.some(x=>x.name===p.name))throw Error('Existing preset name belongs to another ID: '+p.name);
    const target=join(dir,entry.file);
    if(existsSync(target)){
      if(lstatSync(target).isSymbolicLink()||sha(readFileSync(target))!==entry.sha256)throw Error('Existing voice differs; refusing to overwrite: '+p.id);
    }else files.push(entry);
    if(!match)merged.push(p);
  }
  if(merged.length>64)throw Error('Too many custom presets');
  const metadataChanged=merged.length!==existing.length||presentationChanged.length>0;
  const report={apply,voices:entries.map(x=>({id:x.preset.id,name:x.preset.name})),newFiles:files.map(x=>x.file),metadataChanged,presentationChanged,configurationChanged:false,reloadRequired:metadataChanged};
  if(!apply)return report;
  if(!nonCommercial)throw Error('Confirm the recipient has reviewed the model terms and selected research/non-commercial use (--non-commercial)');
  const lock=join(base,'.breeze-presets-install.lock'),fd=openSync(lock,'wx');
  let temporary;
  try{
    const now=existsSync(metadata)?readFileSync(metadata):null;
    if((old===null)!==(now===null)||old&&!old.equals(now))throw Error('Preset metadata changed during preflight; inspect and retry');
    if(metadataChanged&&old){
      const backup=join(base,'backups','breeze-presets-'+Date.now()+'-'+randomUUID());mkdirSync(backup,{recursive:true});
      copyFileSync(metadata,join(backup,'custom-presets.json'),constants.COPYFILE_EXCL);report.backup=backup;
    }
    mkdirSync(dir,{recursive:true});
    for(const entry of files){
      temporary=join(dir,'.'+entry.file+'.'+randomUUID()+'.pending');
      writeFileSync(temporary,readFileSync(join(packDir,entry.file)),{flag:'wx'});
      // No-clobber atomic publication; a concurrent file is never replaced.
      linkSync(temporary,join(dir,entry.file));unlinkSync(temporary);temporary=undefined;
    }
    // Keep earlier pack provenance intact when a new pack adds more presets.
    const notice=join(base,'licenses','dafeiyu-breeze-presets',sha(readFileSync(join(packDir,'manifest.json'))).slice(0,16));mkdirSync(notice,{recursive:true});report.provenanceDirectory=notice;
    for(const name of ['BREEZEBLUE-LICENSE.txt','NOTICE','manifest.json']){
      const source=readFileSync(join(packDir,name)),target=join(notice,name);
      if(existsSync(target)){if(!readFileSync(target).equals(source))throw Error('Existing pack provenance differs; inspect before replacing');}
      else writeFileSync(target,source,{flag:'wx'});
    }
    if(metadataChanged){
      const latest=existsSync(metadata)?readFileSync(metadata):null;
      if((old===null)!==(latest===null)||old&&!old.equals(latest))throw Error('Preset metadata changed during installation; new voices remain unlisted');
      temporary=metadata+'.'+randomUUID()+'.pending';writeFileSync(temporary,JSON.stringify(merged,null,2)+'\n',{flag:'wx'});renameSync(temporary,metadata);temporary=undefined;
    }
    return report;
  }finally{if(temporary&&existsSync(temporary))unlinkSync(temporary);closeSync(fd);unlinkSync(lock);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),value=k=>{const i=args.indexOf(k);if(i<0||!args[i+1]||args[i+1].startsWith('--'))throw Error('Missing '+k);return args[i+1];};
  console.log(JSON.stringify(installPresets({root:value('--root'),voices:args.includes('--voices')?value('--voices').split(','):undefined,apply:args.includes('--apply'),nonCommercial:args.includes('--non-commercial')})));
}
