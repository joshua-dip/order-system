"""Link completed production questions to exported training rows and prepare one fact cycle."""
import collections,hashlib,json,random,re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
batch=ROOT/'ml/production/batches/2026-09-27-jun23-go1-01'
cycle=ROOT/'ml/production/cycles/2026-09-27-fact-production'
data=ROOT/'data/production-2026-09-27'
docs=json.loads((batch/'completed-snapshot.json').read_text())
assert len(docs)==27 and all(d['status']=='완료' for d in docs)
maptype={'주제':'topic','제목':'title','주장':'claim','일치':'fact','불일치':'fact','빈칸':'blank','요약':'summary'}
norm=lambda s:re.sub(r'\s+',' ',s).strip()
manifest=json.loads((batch/'manifest.json').read_text());originals={p['passage_id']:p['original'] for p in manifest['passages']}
sets={s:json.loads((cycle/(s+'-sources.json')).read_text()) for s in ['sep26-go1','jun11-go2']}
evaltexts=[norm(x) for d in sets.values() for x in d.values()]
usertext=lambda row:norm(row['messages'][1]['content'].split('[지문 Paragraph]\n',1)[-1])
exports={t:[json.loads(l) for split in ['train','valid'] for l in (data/(t+'-export')/(split+'.jsonl')).read_text().splitlines()] for t in set(maptype.values())}
feedback=collections.defaultdict(list);links=[];rule=[]
for d in docs:
 t=maptype.get(d['type'])
 if not t:rule.append(d);continue
 q=d['question_data'];hits=[]
 for row in exports[t]:
  a=json.loads(row['messages'][2]['content'])
  if usertext(row)==norm(originals[d['passage_id']]) and norm(a.get('Options',''))==norm(q['Options']) and a.get('CorrectAnswer')==q['CorrectAnswer'] and a.get('Explanation')==q['Explanation']:hits.append(row)
 if len(hits)!=1:raise ValueError((d['id'],t,len(hits)))
 row=hits[0]; assert usertext(row) not in evaltexts
 feedback[t].append(row);links.append({'id':d['id'],'type':t,'source':d['source'],'row_sha256':hashlib.sha256(json.dumps(row,ensure_ascii=False).encode()).hexdigest(),'reviewer':'Codex AI','human_reviewed':False})
packet=batch/'training-feedback';packet.mkdir(exist_ok=True)
write=lambda p,rows:p.write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in rows))
for t,rows in feedback.items():write(packet/(t+'.jsonl'),rows)
(packet/'rule-cases.json').write_text(json.dumps(rule,ensure_ascii=False,indent=2)+'\n')
(packet/'index.json').write_text(json.dumps({'lora_rows':len(links),'rule_cases':len(rule),'links':links,'excluded_independent_eval_passage_ids':list(originals)},ensure_ascii=False,indent=2)+'\n')
# Seeded replay from the existing training data; holdout inputs are disjoint by normalized text.
seed=20260927;rng=random.Random(seed);oldtrain=[json.loads(x) for x in (ROOT/'data/fact-finetune/train.jsonl').read_text().splitlines()];oldvalid=[json.loads(x) for x in (ROOT/'data/fact-finetune/valid.jsonl').read_text().splitlines()]
production={norm(x) for x in originals.values()}
def safe(row):
 u=usertext(row)
 return u not in production and not any(e==u or e[:150] in u or e[-150:] in u for e in evaltexts)
validation=[];vseen=set()
for r in oldvalid:
 u=usertext(r)
 if safe(r) and u not in vseen:validation.append(r);vseen.add(u)
rng.shuffle(validation);validation=validation[:64];vseen={usertext(r) for r in validation}
replay=[];seen=set()
for r in oldtrain:
 u=usertext(r)
 if safe(r) and u not in vseen and u not in seen:replay.append(r);seen.add(u)
rng.shuffle(replay);replay=replay[:512];train=replay+feedback['fact']*20;rng.shuffle(train)
assert len(train)==632 and len(validation)==64
assert not ({usertext(x) for x in train}&{usertext(x) for x in validation})
out=data/'fact-cycle';out.mkdir(exist_ok=True);write(out/'train.jsonl',train);write(out/'valid.jsonl',validation)
meta={'seed':seed,'replay_rows':512,'production_unique_rows':6,'production_passages':3,'production_copies_each':20,'train_rows':632,'valid_rows':64,'steps':300,'learning_rate':1e-5,'resume':'existing fact-lora/adapters.safetensors','human_reviewed':False,'training_data':str(out),'train_sha256':hashlib.sha256((out/'train.jsonl').read_bytes()).hexdigest(),'valid_sha256':hashlib.sha256((out/'valid.jsonl').read_bytes()).hexdigest(),'eval_and_production_excluded_from_holdout':True,'input_overlap_train_valid':0}
(cycle/'training-plan.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n');print('feedback',dict((k,len(v)) for k,v in feedback.items()),'rule',len(rule));print(meta)
