import {createHash} from 'node:crypto';

// One source of truth for the workbench. No editable audio parameters live there.
export function savedProfile(state){
 const engine=state.engine;
 if(!['breeze','rvc'].includes(engine))throw Error('统一翻唱引擎无效，请到音色切换中保存');
 const voice=engine==='breeze'?state.selectedVoice:state.rvcVoice;
 const entry=(engine==='breeze'?state.voices:state.rvcVoices).find(v=>v.id===voice);
 const arrangement=engine==='breeze'?state.breezeArrangement:state.rvcArrangement;
 if(!['mixed','acappella'].includes(arrangement))throw Error('统一输出版本无效，请到音色切换中保存');
 const profile={engine,engineName:engine==='breeze'?'Breeze CPP':'RVC',voice,voiceName:entry?.name||entry?.id||voice||'尚未选择音色',arrangement,arrangementName:arrangement==='acappella'?'清唱':'带伴奏',keepMelody:engine==='breeze'?Number(state.keepMelody):0,pitch:engine==='rvc'?Number(state.rvcPitch||0):0,reuseFinished:state.reuseFinished!==false};
 profile.revision=createHash('sha256').update(JSON.stringify(profile)).digest('hex').slice(0,24);
 profile.ready=!!entry&&(engine==='breeze'?!!state.ready:!!state.rvcReady);
 return profile;
}

export function taskFromSavedProfile(state,body={}){
 if(!body||typeof body!=='object'||Array.isArray(body))throw Error('制作参数格式错误');
 if(['engine','voice','rvcVoice','arrangement','keepMelody','pitch','reuseFinished'].some(k=>body[k]!==undefined))throw Error('旧版制作页含独立音色参数，请刷新；声音设置已统一到音色切换');
 const p=savedProfile(state);
 if(!body.profileRevision||body.profileRevision!==p.revision)throw Error('统一声音设置已变化，请核对页面顶部的新摘要后再开始制作');
 if(!p.ready)throw Error('当前统一翻唱引擎或音色未就绪，不会改用其他声音');
 const args={engine:p.engine,voice:p.voice,arrangement:p.arrangement,keepMelody:p.keepMelody,pitch:p.pitch,reuseFinished:p.reuseFinished};
 for(const k of ['sourceId','songId','file','title','startSec','durationSec','lyrics'])if(body[k]!==undefined)args[k]=body[k];
 return args;
}
