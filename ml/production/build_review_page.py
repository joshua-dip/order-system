"""Render saved pending questions with an answer key derived from the reviewed draft.

Bodies/options come from the read-only DB snapshot. Answers/explanations are
renumbered from the reviewed draft by matching option text; this is not a fresh
human review or a read of the DB answer key.
"""
import collections
import html
import json
import re
import sys
from pathlib import Path

batch, output = map(Path, sys.argv[1:3])
completed = '--completed' in sys.argv
read = lambda name: json.loads((batch / name).read_text())
manifest, reviews = read('manifest.json'), read('review.json')['grades']
keys, drafts, writes = read('reviewed-keys.json'), read('reviewed.json'), read('save-result.json')['results']
stored = {q['generated_question_id']: q for q in read('pending-snapshot.json')['items']}
esc = html.escape

def body(s):
    return esc(s).replace('&lt;u&gt;', '<u>').replace('&lt;/u&gt;', '</u>').replace('\n', '<br>')

if completed:
    snapshot = {d['id']: d for d in read('completed-snapshot.json')}
    for i, saved in enumerate(writes):
        d = snapshot[saved['inserted_id']]
        assert d['status'] == '완료'
        drafts[i]['question_data'] = d['question_data']
        stored[saved['inserted_id']] = {'paragraph':d['question_data']['Paragraph'], 'question':d['question_data']['Question'], 'options':d['question_data']['Options']}

cards = []
for key, draft, saved in zip(keys, drafts, writes):
    q = draft['question_data']; db = stored[saved['inserted_id']]
    assert db['paragraph'] == q['Paragraph'] and db['question'] == q['Question']
    parts = lambda s: [x.strip() for x in s.split('###')]
    old, new = parts(q['Options']), parts(db['options'])
    strip = lambda s: re.sub(r'^[①②③④⑤]\s*', '', s).strip()
    assert sorted(map(strip, old)) == sorted(map(strip, new))
    mapping = {n: n for n in '①②③④⑤'}
    if len(set(map(strip, old))) == 5:
        mapping = {o[0]: next(n[0] for n in new if strip(n) == strip(o)) for o in old}
    renumber = lambda text: re.sub('[①②③④⑤]', lambda m: mapping[m[0]], text)
    r = reviews[key]
    cards.append(f'''<article id="q{len(cards)+1}"><div class="meta">{esc(draft['source'])} · {esc(draft['type'])} · DB 대기</div>
<h2>{len(cards)+1}. {esc(db['question'])}</h2><div class="passage">{body(db['paragraph'])}</div>
<div class="options">{''.join('<p>'+esc(x)+'</p>' for x in new)}</div>
<details><summary>정답·해설 펼치기</summary><h3>정답 {renumber(q['CorrectAnswer'])}</h3><p>{esc(renumber(q['Explanation']))}</p></details>
<details><summary>AI 검수·수정 기록</summary><p>초안 {r['grade']} · {'내용 수정' if r.get('edits') else '내용 무수정 (저장 형식 정리 포함)'}</p><p>{esc(r['reason'])}</p><small>문항 ID: {saved['inserted_id']}</small></details></article>''')
held = ''.join(f'<tr><td>{esc(k)}</td><td>{v["grade"]}</td><td>{esc(v["reason"])}</td></tr>' for k,v in reviews.items() if k not in keys)
page = '''<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>23년 6월 고1 · 첫 제작 검수본</title>
<style>:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#101317;color:#e8edf3;font:17px/1.8 system-ui,sans-serif}main{max-width:940px;margin:0 auto;padding:48px 24px}a{color:#7ab3ff}h1{font-size:34px;line-height:1.35}h2{font-size:23px}h3{font-size:18px}.meta,small{color:#aab4c0}article{margin:48px 0;border-top:1px solid #364050;padding-top:24px}.passage{background:#191f28;padding:24px;border-radius:12px;line-height:1.9}.options p{margin:10px 0}details{background:#171d25;padding:16px 20px;border-radius:8px;margin:12px 0}summary{cursor:pointer;color:#8dbbff}summary:focus-visible{outline:2px solid #8dbbff}table{border-collapse:collapse;width:100%;font-size:14px}td,th{padding:12px;border-bottom:1px solid #364050;text-align:left;vertical-align:top}.scroll{overflow-x:auto}.notice{border-left:3px solid #8dbbff;padding-left:18px}nav{display:flex;flex-wrap:wrap;gap:12px}u{text-underline-offset:4px}</style><main>
<a href="notebook.html#l32">← 실습 노트 32과</a><h1>23년 6월 고1<br>첫 제작 검수본 · 27문항</h1><p class="notice">20·22·23번 지문에서 36회 제작을 시도했습니다. 내용 무수정 8건과 Codex가 고친 19건을 대기로 저장했고, 9건은 보류·실패로 분리했습니다. 아래 문항은 선생님 최종 확인 전입니다. 문제를 먼저 풀고 정답을 펼쳐 주세요.</p><p>지문·보기는 저장 후 조회한 순서입니다. 정답·해설은 검수 원고를 그 보기 순서에 맞춘 것입니다. DB 형식·정답·해설 정합성 검사에는 오류가 없었지만, 이것이 의미적 유일성이나 상품 합격을 보증하지 않습니다.</p><nav>'''
page += ''.join(f'<a href="#q{i}">{i}</a>' for i in range(1,len(cards)+1)) + '</nav>' + ''.join(cards)
page += '<h2>저장하지 않은 9건</h2><div class="scroll"><table><tr><th>지문·유형</th><th>초안</th><th>보류·실패 이유</th></tr>'+held+'</table></div><p>AI 평가이며 독립 사람·블라인드 검수가 아닙니다. 이번 지문은 생산·수정에 사용했으므로 향후 독립 평가용 새 지문에서 제외합니다.</p></main></html>'
if completed:
    page = page.replace('DB 대기','DB 완료 · Codex AI 검수')
    page = page.replace('내용 무수정 8건과 Codex가 고친 19건을 대기로 저장했고, 9건은 보류·실패로 분리했습니다. 아래 문항은 선생님 최종 확인 전입니다. 문제를 먼저 풀고 정답을 펼쳐 주세요.', '최초 대기 저장 27건을 추가 검수·수정한 뒤 사용자 요청에 따라 모두 완료로 전환했습니다. 생성본 보류·실패 9건은 그대로 분리했습니다. 완료는 Codex AI 검수 결과이며 독립 사람 검수나 모델의 상품 성능 승인을 뜻하지 않습니다.')
    page = page.replace('정답·해설은 검수 원고를 그 보기 순서에 맞춘 것입니다.', '정답·해설도 완료 전환 후 DB에서 조회한 저장본입니다.')
    page = page.replace('초안 ', '생성 당시 초안 ')
    page = page.replace('<summary>AI 검수·수정 기록</summary>', '<summary>최초 AI 검수·수정 기록 (추가 검수는 노트 33과)</summary>')
    page = page.replace('notebook.html#l32','notebook.html#l33').replace('실습 노트 32과','실습 노트 33과')
output.write_text(page,encoding='utf-8')
print(f'Rendered {len(cards)} questions; stored bodies and option sets verified')
