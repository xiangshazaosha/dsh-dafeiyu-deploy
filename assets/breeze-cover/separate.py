import argparse,json,logging,os
from pathlib import Path
import torch
from audio_separator.separator import Separator
p=argparse.ArgumentParser();p.add_argument('--input',required=True);p.add_argument('--output',required=True);p.add_argument('--models',required=True);p.add_argument('--model',required=True);p.add_argument('--ffmpeg-bin',required=True);a=p.parse_args()
torch.set_num_threads(4)
os.environ['PATH']=a.ffmpeg_bin+os.pathsep+os.environ.get('PATH','')
models=Path(a.models);model=Path(a.model)
if model.name!=a.model or not (models/model).is_file() or not (models/model.with_suffix('.yaml')).is_file():raise RuntimeError('Existing separator model/config is missing; no downloads are performed')
out=Path(a.output);out.mkdir(parents=True,exist_ok=True)
s=Separator(log_level=logging.WARNING,model_file_dir=str(models),output_dir=str(out),output_format='WAV',sample_rate=44100,mdxc_params={'segment_size':256,'override_model_segment_size':False,'batch_size':1,'overlap':2,'pitch_shift':0})
s.load_model(model_filename=a.model)
files=s.separate(a.input)
vocals=next((str(out/x) for x in files if '(Vocals)' in x),None)
inst=next((str(out/x) for x in files if '(Instrumental)' in x or '(Other)' in x),None)
if not vocals or not inst:raise RuntimeError('Both vocal and instrumental stems are required')
(out/'stems.json').write_text(json.dumps({'vocals':vocals,'instrumental':inst}),encoding='utf-8')
print('SEPARATION_COMPLETE',flush=True)
