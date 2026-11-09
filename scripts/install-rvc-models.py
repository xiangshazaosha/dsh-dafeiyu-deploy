"""Install an Agent-reviewed model manifest into an existing RVC root, without changing defaults."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


def install(root, manifest, apply=False):
    root=Path(root).resolve()
    if not (root/'env/Scripts/python.exe').is_file() or not (root/'Applio/core.py').is_file():
        raise ValueError('Reuse a verified existing Windows RVC root; this helper does not install the engine')
    data=json.loads(Path(manifest).read_text(encoding='utf-8-sig'))
    items=data['models']
    if not 1<=len(items)<=20:raise ValueError('Select 1-20 models explicitly')
    seen=set()
    for x in items:
        name=x['id']
        if not name or name in seen or any(c in name for c in '/\\:*?"<>|') or name.endswith(('.', ' ')) or name in ('.','..'):
            raise ValueError('Invalid or duplicate model ID')
        seen.add(name)
        if not x.get('source') or not x.get('usageNotice') or not x['url'].startswith('https://'):
            raise ValueError('Missing source/usage review or HTTPS URL')
        if len(x['sha256'])!=64:raise ValueError('Missing SHA256')
    if not apply:return {'apply':False,'models':[x['id'] for x in items],'defaultsChanged':False}
    stage=root/'downloads'/'reviewed-models'
    stage.mkdir(parents=True,exist_ok=True)
    (root/'models').mkdir(exist_ok=True)
    results=[]
    for x in items:
        path=stage/(x['sha256']+'.pth')
        subprocess.run([sys.executable,'-I',str(Path(__file__).with_name('fetch-verified.py')),x['url'],str(path),x['sha256'],'--size',str(x['bytes'])],check=True)
        check=subprocess.run([str(root/'env/Scripts/python.exe'),'-I',str(Path(__file__).with_name('inspect-rvc.py')),str(path),x['sha256']],capture_output=True,text=True,check=True)
        inspection=json.loads(check.stdout)
        dest=root/'models'/(x['id']+'.pth')
        if dest.exists():
            if hashlib.sha256(dest.read_bytes()).hexdigest()!=x['sha256']:raise ValueError('Existing voice differs; refusing overwrite')
        else:
            pending=dest.with_suffix('.pth.importing')
            with path.open('rb') as src,pending.open('xb') as dst:shutil.copyfileobj(src,dst)
            os.link(pending,dest)
            pending.unlink()
        results.append({**x,'inspection':inspection,'installedPath':str(dest),'hasIndex':False})
        # Retain a per-model provenance record even if a later model fails.
        (stage/(x['sha256']+'.json')).write_text(json.dumps(results[-1],ensure_ascii=False,indent=2),encoding='utf-8')
    return {'apply':True,'models':results,'defaultsChanged':False}


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--root',required=True);p.add_argument('--manifest',required=True)
    p.add_argument('--apply',action='store_true',help='Only after the user selected models and usage was reviewed')
    a=p.parse_args()
    print(json.dumps(install(a.root,a.manifest,a.apply),ensure_ascii=True))
