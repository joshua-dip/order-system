import csv, json, re
from collections import defaultdict
db = {r['k']: r for r in json.load(open('db-textbooks.json'))}
prods = [dict(zip(['st','pub','cur','type','title'], l.rstrip('\n').split('\t'))) for l in open('solvook-prods.tsv', encoding='utf-8') if l.strip()]
src = {}
for l in open('solvook-src.tsv', encoding='utf-8'):
    if not l.strip(): continue
    t,n,sell,uses,won,sold,first,last,types = l.rstrip('\n').split('\t')
    src[t] = dict(n=int(n), sell=int(sell), uses=int(uses), won=int(won), sold=int(sold), first=first, last=last, types=types)
cost = {}
for r in list(csv.reader(open('license-sheet.csv', encoding='utf-8')))[2:]:
    if len(r) > 6:
        n = lambda x: int(x.replace(',','')) if x.replace(',','').isdigit() else None
        v = (n(r[4]), n(r[5]), n(r[6]))
        cost[r[2].strip()] = v if v[0] is not None else ('제외', r[4])
# 부교재·EBS 대응 (쏠북 → DB, 비고)
M = {
 '수능특강 영어독해연습 수록 원문(2027)': ['2027수능특강 영어독해연습(2026)'],
 '수능특강 영어 수록 원문(2027)': ['2027수능특강 영어(2026)'],
 '빠른독해 바른독해 수능실전(2024)': ['빠른독해바른독해 수능실전'],
 '빠른독해 바른독해 유형독해(2024)': ['빠른독해바른독해 유형독해(2022)', '판(2022)'],
 '빠른독해 바른독해 구문독해(2024)': ['빠른독해바른독해 구문독해'],
 '빠른독해 바른독해 기초세우기(2024)': ['빠른독해바른독해 기초세우기(2024.10)'],
 '수능만만 영어독해 20회': ['수능만만 영어독해 20회'],
 '얇고 빠른 수능 독해 기본 미니 모의고사 10+2회': ['얇고 빠른 미니 모의고사 기본'],
 '얇고 빠른 수능 독해 입문 미니 모의고사 10+2회': ['얇고 빠른 미니 모의고사 입문'],
 'The 더 상승 구문편(2024)': ['The 상승 구문편(2024.01)'],
 'The 더 상승 수능유형편(2024)': ['The 상승 수능유형편(2024.01)'],
 'The 더 상승 문법독해편(2024)': ['The 상승 문법독해편(2020)', '구판(2020) 지문'],
 'The 더 상승 직독직해편(2024)': ['The 상승 직독직해편(2020)', '구판(2020) 지문'],
 '수능유형 픽 PICK 독해 기본 (2023)': ['수능유형 PICK 독해 기본 [2022 개정](2023.01)'],
 '수능유형 픽 PICK 독해 실력 (2023)': ['수능유형 PICK 독해 실력 [2022 개정](2023.01)'],
 'Booster(부스터) 구문독해 (2022)': ['Booster 구문독해'],
 'Booster(부스터) 유형독해 (2022)': ['Booster 유형독해(2022)'],
 'Booster(부스터) 어법어휘 (2022)': ['Booster 어법어휘'],
 '파워업 독해유형편': ['파워업 독해유형편(2020)'],
 '파워업 독해실전편 모의고사 15회': ['파워업 독해실전편 모의고사 15회(2020)'],
 '올림포스 전국연합학력평가 기출문제집 영어독해 고1 (2026)': ['2026 올림포스 전국연합학력평가 기출문제집 영어독해 고1'],
 '올림포스 전국연합학력평가 기출문제집 영어독해 고2 (2026)': ['2026 올림포스 전국연합학력평가 기출문제집 영어독해 고2(2025.10)'],
 '수능 기출의 미래 영어독해(2027)': ['2027학년도 수능 대비 수능 기출의 미래 영어독해(2025.12)'],
 '수능특강 Light 영어 수록 원문(2025)': ['EBS 수능특강 Light 고등 영어(2026)', '연도 표기 확인'],
 '수능특강 Light 영어독해연습 수록 원문(2025)': ['수능특강 Light 영어독해연습(2026)', '연도 표기 확인'],
 '하루 6개 1등급 영어독해 고1 (2025)': ['하루 6개 1등급 영어독해 전국연합학력평가 기출 고1(2025.10)'],
 '올림포스 영어독해 9대 변별유형 수록 원문(2025)': ['올림포스 영어독해 9대 변별유형(2026)', '연도 표기 확인'],
 '올림포스 영어독해 기본 1 수록 원문(2025)': ['올림포스 영어독해 기본1(2024.10)'],
 '올림포스 영어독해 기본 2 수록 원문(2025)': ['올림포스 영어독해 기본2(2024.10)'],
 'Reading Power 유형편 기본 수록 원문(2016)': ['ReadingPower 유형편기본'],
 '맞수 수능유형 실전편': ['맞수 수능유형 실전편(2020)'], '맞수 수능유형 기본편': ['맞수 수능유형 기본편(2020)'],
 '맞수 구문독해 기본편': ['맞수 구문독해 기본편(2020)'], '맞수 구문독해 실전편': ['맞수 구문독해 실전편(2020)'],
 '맞수 빈칸추론': ['맞수 빈칸추론(2020)'], '맞수 수능문법어법 기본편': ['맞수 수능문법어법 기본편(2020)'],
 '맞수 수능문법어법 실전편': ['맞수 수능문법어법 실전편(2020)'],
 '수능만만 영어 어법 어휘 228제(2022)': ['수능만만 어법 어휘 228제(2022)'],
 '첫단추 독해실전편(2025)': ['첫단추 독해실전편'],
 '[15개정][NE능률] 영어권 문화 (김정렬)': ['영어권 문화_NE능률김정렬'],
}
SUBJ = {'공통영어 1':'공통영어1','공통영어 2':'공통영어2','고등 영어 Ⅰ':'영어I','고등 영어 Ⅱ':'영어II','중학 영어 1':'중1','중학 영어 2':'중2','영어 독해와 작문':'영어 독해와 작문'}
# 모의고사 연도·학년 집계
mock = defaultdict(lambda: dict(p=0,q=0,done=0,src=0))
for k, r in db.items():
    m = re.match(r'^(\d{2})년 \d{1,2}월 고([123])', k)
    if m: y, g = 2000+int(m.group(1)), m.group(2)
    else:
        m = re.match(r'^수능_(\d{4})_1[12]월', k)
        if m: y, g = int(m.group(1)), '3'
        else:
            m = re.match(r'^고([123])_(\d{4})_', k)
            if not m: continue
            y, g = int(m.group(2)), m.group(1)
    a = mock[(y, g)]; a['p'] += r['p']; a['q'] += r['q']; a['done'] += r['done']; a['src'] += 1
def cat(p):
    t = p['title']
    if p['pub'] == '수능/모의고사': return '모의고사'
    if p['pub'] == 'EBS': return 'EBS'
    if p['type'] == 'textbook' and t.startswith('['): return '교과서'
    if p['pub'] == '쏠북 오리지널': return '오리지널'
    if re.search(r'VOCA|Grammar|GRAMMAR|영문법|어원|천문장|문법편|빈출어법|어법 Start|어법 완성|특급 어법', t): return '어휘·문법서'
    return '부교재'
out = []
for p in prods:
    t = p['title']; c = cat(p); note = ''
    keys = []
    if c == '교과서':
        m = re.match(r'^\[(\d+)개정\]\[(.+?)\] (.+) \((.+)\)$', t)
        if m and m.group(3) in SUBJ and m.group(1) == '22':
            keys = [f"{SUBJ[m.group(3)]}_{m.group(2)}{m.group(4)}"]
        elif t in M: keys = [M[t][0]]
    elif t in M:
        keys = [M[t][0]]; note = M[t][1] if len(M[t]) > 1 else ''
    agg = dict(p=0,q=0,done=0,narr=0,essay=0)
    if c == '모의고사':
        m = re.match(r'^(\d{4}) 고([123])', t)
        y, g = int(m.group(1)), m.group(2)
        a = mock.get((y, g), dict(p=0,q=0,done=0)); agg.update(p=a['p'], q=a['q'], done=a['done'])
    for k in keys:
        r = db.get(k)
        if r:
            for f in agg: agg[f] += r.get(f, 0)
    s = src.get(t, dict(n=0,sell=0,uses=0,won=0,sold=0,first='',last='',types=''))
    co = cost.get(t, (0,0,0))
    if co and co[0] == '제외': note = (note + ' · 후차감 대상 제외').strip(' ·'); co = (0,0,0)
    co = co if p['pub'] not in ('EBS','수능/모의고사','마더텅','수경출판사','쏠북 오리지널') else (0,0,0)
    if p['pub'] in ('NE능률','YBM','지학사','다락원','쎄듀') and t not in cost: note = (note + ' · 비용표에 없음').strip(' ·')
    out.append(dict(title=t, st=p['st'], pub=p['pub'], cur=p['cur'], cat=c, db=keys[0] if keys else '', note=note, **agg,
                    s_n=s['n'], s_sell=s['sell'], s_uses=s['uses'], s_won=s['won'], s_last=s['last'], s_types=s['types'],
                    c1=co[0], c2=co[1], c3=co[2]))
# 우선순위
def tier(r):
    selling = r['s_sell'] > 0
    if r['st'] == '구매': return 'X', '선결제 필요'
    if r['cat'] == '어휘·문법서': return 'Z', '지문 변형용 교재 아님'
    if r['cur'] in ('초등',): return 'Z', '초등'
    if selling:
        return 'S', '판매 중 — 커버리지 보강'
    if r['st'] == '보유':
        if r['q'] > 0: return 'A', '보유 · 문제 있음 · 미등록 → 바로 등록'
        if r['p'] > 0: return 'B', '보유 · 지문 있음 · 문제 0 → 제작 후 등록'
        return 'C', '보유 · DB 지문 없음 → 지문 입력부터'
    # 획득
    free = r['c1'] == 0 and r['pub'] in ('EBS','수능/모의고사','마더텅','수경출판사')
    if free:
        if r['q'] > 0: return 'A', '획득(무료) · 문제 있음 → 신청 후 등록'
        if r['p'] > 0: return 'B', '획득(무료) · 지문 있음'
        return 'D', '획득(무료) · 지문 없음'
    if r['q'] > 0: return 'D', '획득(유료) · 문제 있음'
    if r['p'] > 0: return 'E', '획득(유료) · 지문 있음'
    return 'F', '획득(유료) · 지문 없음'
for r in out:
    r['tier'], r['why'] = tier(r)
order = 'ASBCDEFXZ'
out.sort(key=lambda r: (order.index(r['tier']), -r['q'], -r['p'], r['c1']))
json.dump(out, open('solvook-analysis.json','w'), ensure_ascii=False, indent=0)
from collections import Counter
print(Counter(r['tier'] for r in out))
print(Counter((r['cat'], r['st']) for r in out))
for t in 'ASBC':
    print('\n==', t)
    for r in [x for x in out if x['tier']==t][:40]:
        print(f"  [{r['cat']}] {r['title']} | {r['st']} | DB {r['p']}/{r['q']} | 쏠북 {r['s_sell']}/{r['s_n']} 이용{r['s_uses']} {r['s_won']}원 | 비용 {r['c1']}/{r['c2']} | {r['db']} {r['note']}")
