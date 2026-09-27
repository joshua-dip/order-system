"""Separate observed Codex usage from local output-size proxies. No savings claim."""
import json,re,sys
from pathlib import Path
from transformers import AutoTokenizer
root=Path(__file__).resolve().parents[2];batch=root/'ml/production/batches/2026-09-27-jun23-go1-01'
tok=AutoTokenizer.from_pretrained('mlx-community/Qwen2.5-7B-Instruct-4bit',local_files_only=True)
rows=[json.loads(l) for l in (batch/'raw.jsonl').read_text().splitlines()]
fields=['Question','Options','CorrectAnswer','Explanation']
result_tokens=sum(len(tok.encode(json.dumps({k:r['result']['question_data'].get(k) for k in fields},ensure_ascii=False),add_special_tokens=False)) for r in rows if r['result'].get('question_data'))
review=json.loads((batch/'review.json').read_text())['grades']
edit_tokens=sum(len(tok.encode(json.dumps(d.get('edits'),ensure_ascii=False),add_special_tokens=False)) for d in review.values() if d.get('edits'))
# Only this task's recorded counters are read; no unrelated conversation content exported.
p=Path(sys.argv[1]);last=None;anchors={}
for line in p.open():
 try:r=json.loads(line)
 except:continue
 x=r.get('payload',{})
 if r.get('type')=='event_msg' and x.get('type')=='token_count':last=x.get('info',{}).get('total_token_usage')
 if r.get('type')=='response_item' and x.get('role')=='user':
  text=' '.join(z.get('text','') for z in x.get('content',[]) if isinstance(z,dict))
  for label,needle in [('pilot_start','과 목록에 목록이'),('pilot_end_review_start','27문항 대기 저장된것'),('efficiency_question','효율의 정도')]:
   if needle in text:anchors[label]={'time':r.get('timestamp'),'usage':last}
a=anchors['pilot_start']['usage'];b=anchors['pilot_end_review_start']['usage'];delta={k:b[k]-a[k] for k in a};delta['uncached_input_tokens']=delta['input_tokens']-delta['cached_input_tokens']
report={'observed_pilot_usage':delta,'scope':'목차 정리+제작 도구 작성+36회 로컬 생성 지휘+검수/수정+27건 대기 저장+기록/UI 확인을 모두 포함. 순수 제작만 분리 불가.', 'usage_window':{'start':anchors['pilot_start']['time'],'end':anchors['pilot_end_review_start']['time']},'completed_after_recheck':27,'attempts':36,'generated_payloads':33,'payload_Qwen_tokens_excluding_Paragraph':result_tokens,'edited_field_payload_Qwen_tokens':edit_tokens,'proxy_warning':'Qwen 토크나이저로 결과물 길이를 잰 값. 실제 로컬 엔진 총 생성량(추론·재시도 포함)이나 절약된 Codex 토큰이 아님. 수정 필드에는 기존 지문도 포함될 수 있음.','direct_codex_baseline':None,'measured_token_savings_percent':None,'subscription_allowance_saved_percent':None,'initial_content_unchanged':8,'local_generation_seconds':582.36,'sources':['https://learn.chatgpt.com/docs/pricing','https://developers.openai.com/api/docs/guides/agents-api/observability'],'next_comparison':'유사한 미사용 지문을 두 방식에 배정: 로컬초안+Codex검수 대 Codex직접작성+동일검수. 유형·난도·완료수·모델·문맥을 맞추고 제작/개발 시간을 분리. 완료당 신규입력·캐시입력·출력(추론포함), 수정시간, 치명오류를 비교.'}
report['generation_only']={'scope':'Local draft model calls only; orchestration, review, edits, storage, development, notes, training and evaluation excluded.','attempts':len(rows),'outputs':sum(bool(r['result'].get('question_data')) for r in rows),'elapsed_seconds':round(sum(r['generation_seconds'] for r in rows),2),'seconds_per_output_including_failed_attempts':round(sum(r['generation_seconds'] for r in rows)/sum(bool(r['result'].get('question_data')) for r in rows),2),'codex_tokens_consumed_by_local_model_calls':0,'direct_codex_generation_tokens':None,'saved_codex_tokens_per_question':None}
(batch/'efficiency.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report,ensure_ascii=False,indent=2))
