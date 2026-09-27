"""Build timing/source inventory only; never inspect answer quality or change DB state."""
import json,sys,html,statistics
from pathlib import Path
from datetime import datetime
from collections import Counter
batch=Path(sys.argv[1]); output=Path(sys.argv[2]); load=lambda n,default:json.loads((batch/n).read_text()) if (batch/n).exists() else default
manifest=load('manifest.json',{}); snapshot=load('job-results.json',{}); models=load('worker-models.json',{}); workers={w['_id']:w for w in models.get('workers',[])}
jobs={j['requested_by'].split(':',2)[-1]:j for j in snapshot.get('jobs',[])}
saved=load('pending-saved-snapshot.json',[]); saved=saved.get('items',[]) if isinstance(saved,dict) else saved
byid={str(r.get('_id',r.get('id'))):r for r in saved}
receipts=load('queue-receipts.json',[]); receipt={r['key']:r['job_id'] for r in receipts}
ko={'queued':'생성 대기','running':'생성 중','done':'초안 생성됨','failed':'생성 실패','cancelled':'취소'}
def dt(v):
 try:return datetime.fromisoformat(v.replace('Z','+00:00'))
 except (AttributeError,ValueError):return None
def elapsed(a,b):
 x,y=dt(a),dt(b);return round((y-x).total_seconds(),2) if x and y else None
def fmt(v):return '—' if v is None else f'{v:.2f}'
def esc(v):return html.escape(str(v))
rows=[]
for i,s in enumerate(manifest['slots'],1):
 j=jobs.get(s['key'],{});r=j.get('result') or {};w=workers.get(j.get('claimed_by'),{});a=r.get('adapter') or {};qid=str(j.get('saved_question_id') or '');doc=byid.get(qid,{})
 typ=s['type'];adapter='fact' if typ in ['일치','불일치'] else a.get('main');rule=typ in ['순서','삽입','무관한문장','어휘','어법']
 row={'index':i,'textbook':s['textbook'],'source':s['source'],'type':typ,'job_id':str(j.get('_id') or receipt.get(s['key'],'')),'question_id':qid or None,'serialNo':doc.get('serialNo'),'generation_status':j.get('status','queued'),'question_status':doc.get('status'),'generation_seconds':round(r['elapsed_ms']/1000,2) if isinstance(r.get('elapsed_ms'),(int,float)) else None,'worker_processing_seconds':elapsed(j.get('claimed_at'),j.get('finished_at')),'queue_wait_seconds':elapsed(j.get('created_at'),j.get('claimed_at')),'attempts':j.get('attempts',0),'base_model':a.get('base_model') or w.get('base_model'),'adapter':('규칙 생성 (LoRA 없음)' if rule else adapter),'reasoner':w.get('reasoner'),'model_evidence':('job result + worker heartbeat snapshot' if a else 'worker heartbeat snapshot; not per-job inference record'),'backend':w.get('backend'),'created_at':j.get('created_at'),'claimed_at':j.get('claimed_at'),'finished_at':j.get('finished_at'),'error':j.get('error'),'review':'미검수'}
 rows.append(row)
summary=[]
for typ in dict.fromkeys(r['type'] for r in rows):
 group=[r for r in rows if r['type']==typ];times=[r['generation_seconds'] for r in group if r['generation_seconds'] is not None];c=Counter(r['generation_status'] for r in group)
 summary.append({'type':typ,'requested':len(group),'done':c['done'],'failed':c['failed'],'waiting_or_running':c['queued']+c['running'],'timed':len(times),'average_seconds':round(statistics.mean(times),2) if times else None,'min_seconds':min(times) if times else None,'max_seconds':max(times) if times else None,'total_measured_seconds':round(sum(times),2)})
report={'batch_id':manifest['batch_id'],'snapshot_at':snapshot.get('at'),'counts':dict(Counter(r['generation_status'] for r in rows)),'review_performed':False,'time_definition':'generation_seconds is recorded pipeline time including internal checks/retries/explanation, excluding queue wait/model load; not isolated first-draft decoding. Worker processing includes model loading and overhead; for retried jobs claimed_at covers latest attempt. Missing values are unmeasured, not zero.','model_definition':'Base/adapter from job result when available; reasoner/backend from captured worker heartbeat, not a per-request model trace. Rule types use rules + reasoner and no LoRA.','by_type':summary,'rows':rows}
report['saved_count']=sum(bool(r['question_id']) for r in rows)
report['saved_status_counts']=dict(Counter(r['question_status'] for r in rows if r['question_id']))
failed_rows=[r for r in rows if r['generation_status'] in ('failed','cancelled') or (r['generation_status']=='done' and not r['question_id'])]
finalized=all(r['generation_status'] not in ('queued','running') for r in rows) and all(r['question_id'] for r in rows if r['generation_status']=='done')
statusline=f"생성 {report['counts'].get('done',0)}건 · 실패 {report['counts'].get('failed',0)}건 · 저장 {report['saved_count']}건 · 대기 상태 {report['saved_status_counts'].get('대기',0)}건"
(batch/'generation-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
md=['# 23년 6월 고1 — 워커 제작 내역','',f"기준 시각: {snapshot.get('at')} / 검수하지 않음",'',report['time_definition'],'','| 번호 | 출처 | 유형 | 생성 초 | 작업 초 | 문항 고유ID | 일련번호 | 상태 | 작업ID | 기본 모델 | 어댑터 | 추론 모델 |','|---|---|---|---:|---:|---|---|---|---|---|---|---|']
body=[]
for r in rows:
 state=(r['question_status'] or ('저장됨·상태 미확인' if r['question_id'] else '미저장'))+' / '+ko.get(r['generation_status'],r['generation_status'])
 values=[r['index'],r['source'],r['type'],fmt(r['generation_seconds']),fmt(r['worker_processing_seconds']),r['question_id'] or '—',r['serialNo'] or '—',state,r['job_id'],r['base_model'] or '미기록',r['adapter'] or '미기록',r['reasoner'] or '미기록']
 md.append('| '+' | '.join(str(v).replace('|',' / ') for v in values)+' |')
 model=f"{r['base_model'] or '미기록'}\n어댑터: {r['adapter'] or '미기록'}\n추론: {r['reasoner'] or '미기록'}"
 cells=[r['index'],r['source'].replace(manifest['textbook']+' ',''),r['type'],fmt(r['generation_seconds']),fmt(r['worker_processing_seconds']),fmt(r['queue_wait_seconds']),r['attempts'],r['serialNo'] or '—',r['question_id'] or '— (미저장)',state,r['job_id'],model]
 body.append('<tr>'+''.join('<td>'+esc(v).replace('\n','<br>')+'</td>' for v in cells)+'</tr>')
md[2] += ' / '+statusline
md += ['', '## 실패·미저장 출처', '', '| 출처 | 유형 | 상태 | 작업ID |', '|---|---|---|---|']
for r in failed_rows:md.append('| '+' | '.join(str(v) for v in [r['source'],r['type'],ko.get(r['generation_status'],r['generation_status'])+' / 미저장',r['job_id']])+' |')
failed_html='<h2>실패·미저장 출처</h2><ul>'+''.join('<li>'+esc(r['source']+' · '+r['type']+' · '+ko.get(r['generation_status'],r['generation_status'])+' / 미저장')+'</li>' for r in failed_rows)+'</ul>' if failed_rows else ''
(batch/'source-index.md').write_text('\n'.join(md)+'\n')
headers=['번호','원문 출처','유형','생성(초)','작업 전체(초)','큐 대기(초)','시도','일련번호','문항 고유ID','상태','워커 작업ID','모델']
sumhtml=''.join('<tr>'+''.join('<td>'+esc(v)+'</td>' for v in [r['type'],r['requested'],r['done'],r['failed'],r['waiting_or_running'],r['timed'],fmt(r['average_seconds']),fmt(r['min_seconds']),fmt(r['max_seconds'])])+'</tr>' for r in summary)
output.parent.mkdir(parents=True,exist_ok=True)
output.write_text('''<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>23년 6월 고1 제작 내역</title><style>body{font-family:system-ui,sans-serif;background:#101318;color:#e8ecf2;margin:32px}h1{font-size:28px}p{line-height:1.8;color:#b9c4d2;max-width:1100px}a{color:#7ab4ff}.table{overflow:auto;margin:20px 0;border:1px solid #354052;border-radius:10px}table{border-collapse:collapse;font-size:13px;width:100%}th,td{padding:12px;text-align:left;border-bottom:1px solid #303846;vertical-align:top}th{background:#202937;white-space:nowrap;position:sticky;top:0}td{min-width:55px}#items td:nth-child(9),#items td:nth-child(11){font-family:monospace}#items td:last-child{min-width:300px}input{background:#202937;color:white;border:1px solid #53667f;padding:12px;width:min(460px,90%);border-radius:6px}.note{background:#1d2633;padding:16px;border-radius:8px}</style><body>'''+f'<a href="notebook.html#l31">← 실습 노트31과</a><h1>{esc(manifest["textbook"])} · 제작 내역</h1><p>요청 {len(rows)}건 · 기준 {esc(snapshot.get("at"))} · <b>미검수 초안</b></p><p>{esc(statusline)}</p>'+'''<p class="note">생성 시간은 워커가 기록한 문제 생성 과정 전체(내부 검사·재시도·해설 포함)이며, 모델 로딩과 큐 대기는 제외합니다. 최초 초안 작성만의 시간은 별도로 측정되지 않았습니다. 작업 전체는 모델 로딩·부가 처리도 포함하며 재시도 시 마지막 시도 기준입니다. 실패해 생성 시간이 없는 칸은 ‘—’로 표시합니다. 미저장 문항의 고유ID·일련번호는 저장 후 채워집니다. 모델은 작업 결과와 워커 설정 기록을 구분해 보관합니다. 규칙 유형은 LoRA 없이 규칙+추론 모델을 사용합니다. 표의 상태는 상단 기준 시각의 저장 기록입니다. 미검수 초안이며 이후 사용자가 바꾼 상태는 이 정적 표에 자동 반영되지 않습니다.</p><h2>유형별 수량·시간</h2><div class="table"><table><thead><tr>'''+''.join('<th>'+x+'</th>' for x in ['유형','요청','생성됨','실패','대기/진행','시간 측정 수','평균 초','최소 초','최대 초'])+'</tr></thead><tbody>'+sumhtml+'''</tbody></table></div>'''+failed_html+'''<h2>문항별 내역</h2><input id="search" placeholder="출처·유형·고유번호 검색" aria-label="문항 검색"><div class="table"><table id="items"><thead><tr>'''+''.join('<th>'+x+'</th>' for x in headers)+'</tr></thead><tbody>'+''.join(body)+'''</tbody></table></div><script>document.querySelector('#search').addEventListener('input',e=>{const q=e.target.value.toLowerCase();document.querySelectorAll('#items tbody tr').forEach(r=>r.hidden=!r.textContent.toLowerCase().includes(q));});</script></body></html>''')
print(json.dumps({'rows':len(rows),'counts':report['counts'],'html':str(output)},ensure_ascii=False))
