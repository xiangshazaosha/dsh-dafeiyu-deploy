"""Inspect an RVC inference checkpoint without arbitrary pickle execution."""
import argparse
import hashlib
import json
from pathlib import Path


def inspect(path, expected):
    path = Path(path)
    if not path.is_file() or path.stat().st_size > 1024*1024*1024:
        raise ValueError('Expected a checkpoint file <=1 GiB')
    h=hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda:f.read(4*1024*1024),b''):h.update(b)
    if h.hexdigest() != expected.lower():raise ValueError('SHA256 mismatch')
    import torch
    torch.set_num_threads(2)
    unsafe=torch.serialization.get_unsafe_globals_in_checkpoint(path)
    if unsafe:raise ValueError('Checkpoint requests unsafe globals; not loading')
    obj=torch.load(path,map_location='cpu',weights_only=True)
    if not isinstance(obj,dict) or not isinstance(obj.get('weight'),dict) or not isinstance(obj.get('config'),list):
        raise ValueError('Not a supported RVC inference checkpoint')
    weights=obj['weight']
    if not weights or not all(isinstance(v,torch.Tensor) for v in weights.values()):raise ValueError('Invalid tensors')
    if not all(torch.isfinite(v).all().item() for v in weights.values()):raise ValueError('Nonfinite tensors')
    return {'sha256':expected.lower(),'bytes':path.stat().st_size,'unsafeGlobals':unsafe,'weightsOnly':True,'tensors':len(weights),'version':obj.get('version'),'sampleRate':obj.get('sr'),'f0':obj.get('f0')}


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('model');p.add_argument('sha256')
    a=p.parse_args()
    print(json.dumps(inspect(a.model,a.sha256)))
