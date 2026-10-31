"""Build an isolated CPU installer from an already installed, compatible Aurabot.

Does not install DSH, QQ gateways, model voices, or accept third-party agreements.
Network/package execution happens only when the agent later runs install-cpu.mjs.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import shutil

PIN = 'c817f1f83f689ef72e0dfeb1c17ae990b9248506'
REQUIREMENT_CALL = "join(p.applio, 'requirements-engine.txt'), 'audio-separator[gpu]'"
STEP = "await step('安装 PyTorch、RVC 和人声分离（最大的一步）',"
ENV_OLD = "return { PATH: p.bin + ';' + process.env.PATH, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }"
ENV_NEW = "return { PATH: p.bin + ';' + process.env.PATH, PYTHONPATH: '', PYTHONNOUSERSITE: '1', PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }"


def validate_source(source: str) -> None:
    expected = [f"export const APPLIO_COMMIT = '{PIN}'", REQUIREMENT_CALL, STEP,
                'https://download.pytorch.org/whl/cu128',
                'https://mirrors.aliyun.com/pytorch-wheels/cu128/']
    for text in expected:
        if source.count(text) != 1:
            raise ValueError('Upstream source differs; review and adapt instead of applying a guessed patch: ' + text)
    if ENV_OLD not in source and ENV_NEW not in source:
        raise ValueError('Unknown subprocess environment layout; inspect pyEnv before proceeding.')


def atomic_text(path: Path, text: str) -> None:
    temp = path.with_name(path.name + '.cpu-prep-tmp')
    if temp.exists():
        raise FileExistsError(temp)
    temp.write_text(text, encoding='utf-8', newline='\n')
    os.replace(temp, path)  # break possible pnpm hard links, never overwrite their inode


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--plugin-dir', required=True, type=Path)
    ap.add_argument('--root', required=True, type=Path)
    ap.add_argument('--check-only', action='store_true')
    ap.add_argument('--apply-runtime-isolation', action='store_true')
    ap.add_argument('--confirm-host-stopped', action='store_true')
    args = ap.parse_args()
    if not args.plugin_dir.is_absolute() or not args.root.is_absolute():
        ap.error('Both paths must be absolute.')
    plugin = args.plugin_dir.resolve(strict=True)
    root = args.root.resolve()
    if plugin == root or plugin in root.parents or root in plugin.parents:
        ap.error('Installer root must be separate from the plugin directory.')
    entry = plugin / 'src' / 'song' / 'studio.js'
    original = entry.read_text(encoding='utf-8')
    validate_source(original)
    if args.apply_runtime_isolation and not args.confirm_host_stopped:
        ap.error('Fully quit DSH, then explicitly pass --confirm-host-stopped for a runtime patch.')
    if args.check_only:
        print(json.dumps({'compatible': True, 'applio_commit': PIN, 'write_performed': False}))
        return

    if args.apply_runtime_isolation:
        root.mkdir(parents=True, exist_ok=True)
        if ENV_OLD in original:
            backup = root / 'runtime-studio-before-isolation.js'
            if backup.exists():
                raise FileExistsError('Existing backup must be preserved: ' + str(backup))
            backup.write_bytes(entry.read_bytes())
            original = original.replace(ENV_OLD, ENV_NEW, 1)
            atomic_text(entry, original)
        print('Runtime subprocess isolation prepared; restart DSH before testing.')
        return

    destination = root / 'cpu-installer'
    driver = root / 'install-cpu.mjs'
    if destination.exists() or driver.exists():
        raise FileExistsError('CPU installer already exists; review it and resume, do not overwrite: ' + str(root))
    # Only installed plugin code; no user configuration, browser profiles or model assets.
    root.mkdir(parents=True, exist_ok=True)
    shutil.copytree(plugin, destination, ignore=shutil.ignore_patterns('node_modules', '.git', '__pycache__', '*.pyc'))
    target = destination / 'src' / 'song' / 'studio.js'
    text = original.replace('https://download.pytorch.org/whl/cu128', 'https://download.pytorch.org/whl/cpu')
    text = text.replace('https://mirrors.aliyun.com/pytorch-wheels/cu128/', 'https://download.pytorch.org/whl/cpu')
    insertion = r"""const cpuReq = join(p.root, 'requirements-cpu.txt')
      const req = readFileSync(join(p.applio, 'requirements-engine.txt'), 'utf8').split(/\r?\n/).filter((line) => !/^(onnxruntime-gpu|nvidia-)/i.test(line.trim())).join('\n') + '\nonnxruntime>=1.17.0\n'
      writeFileSync(cpuReq, req)
      """
    text = text.replace(STEP, insertion + STEP, 1).replace(REQUIREMENT_CALL, "cpuReq, 'audio-separator[cpu]'", 1)
    text = text.replace(ENV_OLD, ENV_NEW, 1)
    atomic_text(target, text)
    root_js = json.dumps(str(root))
    driver_text = """import {createSongStudio} from './cpu-installer/src/song/studio.js';
import {writeFileSync,appendFileSync} from 'node:fs';
import {join} from 'node:path';
const root = ROOT_JSON;
process.env.PYTHONPATH='';
process.env.PYTHONNOUSERSITE='1';
process.env.CUDA_VISIBLE_DEVICES='-1';
process.env.UV_CACHE_DIR=join(root,'uv-cache');
const logFile=join(root,'cpu-install.log');
const emit=(...x)=>{const line=x.join(' ');console.log(line);appendFileSync(logFile,line+'\\n')};
const cfg={song:{root,pypiMirror:'auto',separatorModel:'model_bs_roformer_ep_317_sdr_12.9755.ckpt',enabled:false}};
const log={info:s=>emit('[info]',s),warn:s=>emit('[warn]',s),debug:s=>emit('[debug]',s)};
const studio=createSongStudio({getConfig:()=>cfg,log,sendVoiceFile:async()=>{throw new Error('Installer cannot send QQ messages')}});
emit(studio.install().message);
let last='';
while(true){
 await new Promise(r=>setTimeout(r,5000));
 const s=studio.status();
 const view={running:s.install.running,step:s.install.step,ok:s.install.ok,message:s.install.message,parts:s.parts};
 writeFileSync(join(root,'cpu-install-status.json'),JSON.stringify(view,null,2));
 const line=s.install.step+' '+s.install.log.slice(-1).join('');
 if(line!==last){emit('[progress]',line);last=line;}
 if(!s.install.running){emit('INSTALL_RESULT',JSON.stringify(view));process.exit(s.install.ok?0:1);}
}
""".replace('ROOT_JSON', root_js)
    driver.write_text(driver_text, encoding='utf-8', newline='\n')
    print(json.dumps({'prepared': str(driver), 'download_started': False,
                      'next': 'Review generated source, then run node on this driver; do not use the GPU UI repair button.'}))


if __name__ == '__main__':
    main()
