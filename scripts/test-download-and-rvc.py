import contextlib
import hashlib
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import unittest

def load(name,file):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(file));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
fetch=load('fetch_verified','fetch-verified.py')
inspect=load('inspect_rvc','inspect-rvc.py')
installer=load('install_rvc_models','install-rvc-models.py')

class DownloadTests(unittest.TestCase):
    def test_download_hash_reuse_and_refuse_overwrite(self):
        data=b'bounded-download'*10000;digest=hashlib.sha256(data).hexdigest()
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*a):pass
            def do_HEAD(self):self.send_response(200);self.send_header('Content-Length',str(len(data)));self.end_headers()
            def do_GET(self):
                s,e=map(int,self.headers['Range'][6:].split('-'));chunk=data[s:e+1]
                self.send_response(206);self.send_header('Content-Range',f'bytes {s}-{e}/{len(data)}');self.send_header('Content-Length',str(len(chunk)));self.end_headers();self.wfile.write(chunk)
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            with tempfile.TemporaryDirectory() as t:
                p=Path(t)/'model.bin';url=f'http://127.0.0.1:{server.server_port}/file'
                fetch.download(url,p,digest,chunk_size=16000,workers=3)
                self.assertEqual(p.read_bytes(),data)
                fetch.download(url,p,digest)
                with self.assertRaises(ValueError):fetch.download(url,p,'0'*64)
                with self.assertRaises(ValueError):fetch.download(url,Path(t)/'bad.bin','0'*64,chunk_size=16000)
                self.assertFalse((Path(t)/'bad.bin').exists())
                with self.assertRaises(ValueError):fetch.download(url,Path(t)/'size.bin',digest,size=1)
        finally:server.shutdown();server.server_close();thread.join()

    def test_manifest_preflight_and_traversal(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);(root/'env/Scripts').mkdir(parents=True);(root/'env/Scripts/python.exe').touch();(root/'Applio').mkdir();(root/'Applio/core.py').touch()
            m=root/'input.json';data={'models':[{'id':'voice','source':'https://source.example/model','usageNotice':'reviewed personal use','url':'https://source.example/voice.pth','sha256':'0'*64,'bytes':5}]};m.write_text(json.dumps(data))
            self.assertFalse(installer.install(root,m)['apply']);self.assertFalse((root/'models').exists())
            data['models'][0]['id']='../escape';m.write_text(json.dumps(data))
            with self.assertRaises(ValueError):installer.install(root,m)

class CheckpointTests(unittest.TestCase):
    def test_tensor_validation_and_unsafe_global_rejection(self):
        import torch
        class Payload:
            def __reduce__(self):return (print,('THIS_MUST_NOT_EXECUTE',))
        with tempfile.TemporaryDirectory() as t:
            p=Path(t)/'voice.pth'
            torch.save({'weight':{'emb_g.weight':torch.ones(2,3)},'config':[1,2,3],'version':'v2','sr':'40k','f0':1},p)
            result=inspect.inspect(p,fetch.sha256(p));self.assertTrue(result['weightsOnly'])
            with self.assertRaises(ValueError):inspect.inspect(p,'0'*64)
            torch.save({'weight':{'x':torch.tensor(float('nan'))},'config':[]},p)
            with self.assertRaises(ValueError):inspect.inspect(p,fetch.sha256(p))
            torch.save({'payload':Payload()},p)
            with self.assertRaises(ValueError):inspect.inspect(p,fetch.sha256(p))

if __name__=='__main__':unittest.main()
