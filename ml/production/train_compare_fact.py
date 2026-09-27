"""One bounded local fact continuation experiment. Always restore canonical adapter.

Run only after both baseline runs finished. Candidate remains separate for review;
no worker is started and adoption is a separate, evidence-based decision.
"""
from pathlib import Path
import hashlib,json,os,shutil,signal,subprocess,time
ROOT=Path(__file__).resolve().parents[2]
CYCLE=ROOT/'ml/production/cycles/2026-09-27-fact-production'
ADAPTER=ROOT/'ml/fact/adapters/fact-lora'
BACKUP=ROOT/'ml/fact/adapters/fact-lora.production-baseline-20260927'
CANDIDATE=ROOT/'ml/fact/adapters/fact-production-candidate-20260927'
active=None

def hashes(path):return {str(f.relative_to(path)):hashlib.sha256(f.read_bytes()).hexdigest() for f in path.rglob('*') if f.is_file()}
def run(args,log,timeout):
 global active
 with log.open('w') as out:
  active=subprocess.Popen(args,cwd=ROOT,stdout=out,stderr=out,start_new_session=True)
  try:
   code=active.wait(timeout=timeout)
   if code:raise RuntimeError(f'child exit {code}')
  finally:
   if active.poll() is None:
    os.killpg(active.pid,signal.SIGTERM)
    try:active.wait(timeout=15)
    except subprocess.TimeoutExpired:os.killpg(active.pid,signal.SIGKILL);active.wait()
   active=None

def stop(*_):raise KeyboardInterrupt()
for sig in [signal.SIGTERM,signal.SIGINT]:signal.signal(sig,stop)
state={'status':'starting','started_at':time.time()}
def record(): (CYCLE/'execution.json').write_text(json.dumps(state,indent=2)+'\n')
try:
 for s,n in [('sep26-go1',76),('jun11-go2',72)]:
  rows=[json.loads(l) for l in (ROOT/f'ml/eval/runs/{s}/2026-09-27-fact-production-before.jsonl').read_text().splitlines()]
  assert len(rows)==n and len({(r['num'],r['type'],r['rep']) for r in rows})==n
 assert not CANDIDATE.exists() and not BACKUP.exists()
 original=hashes(ADAPTER);state['baseline_adapter_sha256']=original;state['status']='training';record()
 args=['caffeinate','-i',str(ROOT/'ml/topic/.venv/bin/mlx_lm.lora'),'--model','mlx-community/Qwen2.5-7B-Instruct-4bit','--train','--data',str(ROOT/'data/production-2026-09-27/fact-cycle'),'--adapter-path',str(CANDIDATE),'--resume-adapter-file',str(ADAPTER/'adapters.safetensors'),'--iters','300','--batch-size','1','--learning-rate','1e-5','--num-layers','8','--mask-prompt','--fine-tune-type','lora','--seed','20260927','--steps-per-eval','150','--val-batches','16','--save-every','150']
 state['training_command']=args;record();run(args,CYCLE/'training.log',3600)
 state['candidate_adapter_sha256']=hashes(CANDIDATE)
 assert hashes(ADAPTER)==original
 os.replace(ADAPTER,BACKUP);shutil.copytree(CANDIDATE,ADAPTER)
 state['status']='evaluating_candidate';record()
 for s in ['sep26-go1','jun11-go2']:
  out=ROOT/f'ml/eval/runs/{s}/2026-09-27-fact-production-after.jsonl';assert not out.exists()
  state['evaluating_set']=s;record()
  run(['caffeinate','-i',str(ROOT/'ml/topic/.venv/bin/python'),'ml/eval/run_eval.py','--set',s,'--label','2026-09-27-fact-production-after','--types','match,mismatch','--repeat','2','--keep-trace'],CYCLE/(s+'-after.log'),7200)
 state['status']='evaluated_pending_grading'
except BaseException as exc:
 state['status']='failed'
 state['error']=f'{type(exc).__name__}: {exc}'
 raise
finally:
 if BACKUP.exists():
  # Only this script's temporary candidate directory is removed.
  if ADAPTER.exists():shutil.rmtree(ADAPTER)
  os.replace(BACKUP,ADAPTER)
  state['canonical_restored']=hashes(ADAPTER)==state['baseline_adapter_sha256']
 state['finished_at']=time.time();record()
