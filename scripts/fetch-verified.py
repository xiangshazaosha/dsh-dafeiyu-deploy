"""Bounded, resumable range download with mandatory SHA256; never replace a destination."""
import argparse
import concurrent.futures as cf
import hashlib
import json
from pathlib import Path
import time
import urllib.request as req


def sha256(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda: f.read(4 * 1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def download(url, target, expected, *, size=None, chunk_size=4*1024*1024, workers=8):
    if len(expected) != 64 or any(c not in '0123456789abcdef' for c in expected.lower()):
        raise ValueError('A publisher SHA256 is required')
    expected = expected.lower()
    target = Path(target)
    if target.exists():
        if sha256(target) != expected:
            raise ValueError('Existing destination differs; refusing overwrite')
        return target
    if chunk_size <= 0 or not 1 <= workers <= 16:
        raise ValueError('Invalid chunk size or concurrency')
    target.parent.mkdir(parents=True, exist_ok=True)
    lock = Path(str(target)+'.download-lock')
    with lock.open('x'):
        pass
    try:
        with req.urlopen(req.Request(url, method='HEAD'), timeout=60) as r:
            final = r.url
            actual = int(r.headers['Content-Length'])
        if actual <= 0 or (size is not None and size != actual):
            raise ValueError('Publisher size changed')
        size = actual
        parts = Path(str(target)+'.chunks')
        parts.mkdir(exist_ok=True)
        meta = parts/'download.json'
        identity = {'sha256':expected,'size':size,'chunkSize':chunk_size}
        if meta.exists() and json.loads(meta.read_text()) != identity:
            raise ValueError('Resume metadata differs; preserve old parts and review')
        meta.write_text(json.dumps(identity))
        count = (size+chunk_size-1)//chunk_size

        def fetch(i):
            start, end = i*chunk_size, min(size,(i+1)*chunk_size)-1
            p = parts/f'{i:05d}'
            if p.exists() and p.stat().st_size == end-start+1:
                return
            for attempt in range(3):
                try:
                    request = req.Request(final, headers={'Range':f'bytes={start}-{end}'})
                    with req.urlopen(request, timeout=90) as response:
                        if response.status != 206 or response.headers.get('Content-Range') != f'bytes {start}-{end}/{size}':
                            raise ValueError('Server ignored requested range')
                        tmp = p.with_suffix('.part')
                        with tmp.open('wb') as out:
                            remaining = end-start+1
                            while remaining:
                                block = response.read(min(1024*1024, remaining))
                                if not block:
                                    raise ValueError('Incomplete range')
                                out.write(block)
                                remaining -= len(block)
                            if response.read(1):
                                raise ValueError('Oversized range')
                    tmp.replace(p)
                    return
                except Exception:
                    if attempt == 2:
                        raise
                    time.sleep(attempt+1)
        with cf.ThreadPoolExecutor(max_workers=workers) as pool:
            list(pool.map(fetch, range(count)))
        assembled = Path(str(target)+'.verified-part')
        with assembled.open('wb') as out:
            for i in range(count):
                with (parts/f'{i:05d}').open('rb') as source:
                    for block in iter(lambda: source.read(4*1024*1024), b''):
                        out.write(block)
        if sha256(assembled) != expected:
            raise ValueError('SHA256 mismatch; nothing installed')
        # Atomic no-clobber publication on the same filesystem.
        import os
        os.link(assembled, target)
        assembled.unlink()
        for i in range(count):
            (parts/f'{i:05d}').unlink()
        meta.unlink()
        parts.rmdir()
        return target
    finally:
        lock.unlink(missing_ok=True)


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('url'); p.add_argument('target'); p.add_argument('sha256')
    p.add_argument('--size',type=int)
    p.add_argument('--workers',type=int,default=8)
    args = p.parse_args()
    result = download(args.url,args.target,args.sha256,size=args.size,workers=args.workers)
    print('SHA256 verified:',result)
