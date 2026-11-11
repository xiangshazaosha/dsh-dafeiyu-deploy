// Offline only. No downloads, QQ launch, DSH configuration changes or messages.
import {existsSync,lstatSync,realpathSync,readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {resolve,join,dirname,basename,isAbsolute,relative,sep} from 'node:path';
import {randomBytes} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
const skillRoot=realpathSync(fileURLToPath(new URL('../',import.meta.url)));
const inside=(root,p)=>{const r=relative(root,p);return !r||(!r.startsWith('..'+sep)&&r!=='..'&&!isAbsolute(r));};
function directory(path){
 if(!isAbsolute(String(path||''))||!existsSync(path)||!lstatSync(path).isDirectory()||lstatSync(path).isSymbolicLink())throw Error('Use an existing absolute directory, not a link');
 const real=realpathSync(path);if(inside(skillRoot,real))throw Error('Private runtime configuration must be outside the shared skill');return real;
}
function json(path){if(lstatSync(path).isSymbolicLink()||!lstatSync(path).isFile()||lstatSync(path).size>1024*1024)throw Error('Invalid existing configuration');return JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/,''));}
function port(value){const n=Number(value);if(!Number.isInteger(n)||n<1024||n>65535)throw Error('Choose a port between 1024 and 65535');return n;}
export function buildNapcatConfig({httpPort,wsPort,token}){
 return {network:{httpServers:[{name:'dsh-http',enable:true,host:'127.0.0.1',port:httpPort,enableCors:false,enableWebsocket:false,messagePostFormat:'array',token,debug:false}],httpClients:[],websocketServers:[{name:'dsh-ws',enable:true,host:'127.0.0.1',port:wsPort,messagePostFormat:'array',reportSelfMessage:false,token,debug:false,heartInterval:30000}],websocketClients:[]},musicSignUrl:'',enableLocalFile2Url:false,parseMultMsg:false};
}
export function buildAurabotConnection({httpPort,wsPort,token}){
 // Host API 1.1.24 retains this historical key even in generic OneBot mode.
 return {gateway:'onebot',snowluma:{httpUrl:'http://127.0.0.1:'+httpPort,wsUrl:'ws://127.0.0.1:'+wsPort,httpToken:token,wsToken:token,autoStart:false,autoAttach:false}};
}
export function prepareNapcat({configDir,connectionFile,botQQ,ownerQQ,httpPort=3000,wsPort=3001,apply=false}){
 if(!/^[1-9]\d{4,14}$/.test(String(botQQ))||!/^[1-9]\d{4,14}$/.test(String(ownerQQ))||String(botQQ)===String(ownerQQ))throw Error('Specify distinct valid bot and owner accounts');
 httpPort=port(httpPort);wsPort=port(wsPort);if(httpPort===wsPort)throw Error('HTTP and WS ports must differ');
 const config=directory(configDir);if(!isAbsolute(String(connectionFile||'')))throw Error('Use an absolute private connection file');
 const parent=directory(dirname(connectionFile)),connection=join(parent,basename(connectionFile)),target=join(config,'onebot11_'+botQQ+'.json');
 if(target===connection)throw Error('Account configuration and connection patch must be different files');
 const present=[existsSync(target),existsSync(connection)];
 if(present.some(Boolean)){
  if(!present.every(Boolean))throw Error('Partial or existing configuration found; back up and review instead of overwriting');
  const previous=json(target),patch=json(connection),token=previous.network?.httpServers?.[0]?.token;
  if(!/^[a-f0-9]{64}$/.test(String(token))||JSON.stringify(previous)!==JSON.stringify(buildNapcatConfig({httpPort,wsPort,token}))||JSON.stringify(patch)!==JSON.stringify(buildAurabotConnection({httpPort,wsPort,token})))throw Error('Existing configuration differs; preserve and review it');
  return {ok:true,applied:false,reused:true,filesChanged:0,accountConfigPresent:true,connectionPatchPresent:true,ports:{http:httpPort,ws:wsPort},secretsPrinted:false,qqStarted:false,dshChanged:false};
 }
 if(apply){
  const token=randomBytes(32).toString('hex');let created=false;
  try{writeFileSync(target,JSON.stringify(buildNapcatConfig({httpPort,wsPort,token}),null,2)+'\n',{flag:'wx',mode:0o600});created=true;writeFileSync(connection,JSON.stringify(buildAurabotConnection({httpPort,wsPort,token}),null,2)+'\n',{flag:'wx',mode:0o600});}
  catch(error){if(created)unlinkSync(target);throw error;}
 }
 return {ok:true,applied:apply,reused:false,filesChanged:apply?2:0,ports:{http:httpPort,ws:wsPort},secretsPrinted:false,qqStarted:false,dshChanged:false,note:apply?'Private configuration created; verify login identity before DSH connection':'Check only; verify port availability separately before applying'};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 try{
  const args=process.argv.slice(2),opts={},keys={'--config-dir':'configDir','--connection-file':'connectionFile','--bot-qq':'botQQ','--owner-qq':'ownerQQ','--http-port':'httpPort','--ws-port':'wsPort'};
  for(let i=0;i<args.length;i++){const a=args[i];if(a==='--apply'){if(opts.apply)throw Error('Duplicate option');opts.apply=true;}else if(keys[a]&&!Object.hasOwn(opts,keys[a])&&args[i+1]&&!args[i+1].startsWith('--'))opts[keys[a]]=args[++i];else throw Error('Unknown, duplicate or missing option');}
  console.log(JSON.stringify(prepareNapcat(opts)));
 }catch{console.error('NapCat preparation stopped: check directories, distinct accounts, ports and existing files; no credentials printed.');process.exitCode=1;}
}
