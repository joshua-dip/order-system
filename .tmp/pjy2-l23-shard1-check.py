import json,re
P={o['passage_id']:o for o in json.load(open('/Users/goshua/next-order/.tmp/pjy2-l23-shard1-passages.json'))}
items=json.load(open('/Users/goshua/next-order/.variant-drafts/pjy2-l23-shard1.json'))
C='①②③④⑤'; PERM={'①':'ACB','②':'BAC','③':'BCA','④':'CAB','⑤':'CBA'}
norm=lambda t:re.sub(r'\s+',' ',t).strip()
bad=0; seq=[]
for n,it in enumerate(items,1):
    q=it['question_data']; orig=norm(P[it['passage_id']]['content']['original']); a=q['CorrectAnswer']; seq.append(a)
    errs=[]
    if it['source']!=P[it['passage_id']]['source_key']: errs.append('source')
    L=len(q['Explanation']);
    if not(180<=L<=450): errs.append(f'expl len {L}')
    part={'①':'이','②':'가','③':'이','④':'가','⑤':'가'}[a]
    if not q['Explanation'].startswith(f'{a}{part} 정답입니다.'): errs.append('expl start')
    if '논리 흐름 요약:' not in q['Explanation']: errs.append('no summary')
    if it['type']=='순서':
        parts=q['Paragraph'].split('\n\n'); given=parts[0]; blocks={p[1]:norm(p[4:]) for p in parts[1:]}
        if list(blocks)!=['A','B','C'] or len(parts)!=4: errs.append('block fmt')
        if not orig.startswith(norm(given)): errs.append('given not prefix')
        pos={k:orig.find(v) for k,v in blocks.items()}
        if any(v<0 for v in pos.values()): errs.append('block not in orig')
        order=''.join(sorted(pos,key=pos.get))
        if order!=PERM[a]: errs.append(f'perm {order} vs {PERM[a]}')
        rebuilt=norm(given+' '+' '.join(blocks[k] for k in PERM[a]))
        if rebuilt!=orig: errs.append('rebuild != orig')
    else:
        given,body=q['Paragraph'].split('\n\n',1)
        if norm(given) not in orig: errs.append('given not in orig')
        cnt=sum(body.count(c) for c in C)
        if cnt!=5 or any(body.count(c)!=1 for c in C): errs.append(f'markers {cnt}')
        rebuilt=body.replace(a,'\x00')
        for c in C: rebuilt=rebuilt.replace(' '+c,'').replace(c,'')
        rebuilt=rebuilt.replace('\x00',' '+given+' ' if not rebuilt.endswith('\x00') else ' '+given)
        if norm(rebuilt)!=orig: errs.append('rebuild != orig')
    print(n,it['type'],a,'OK' if not errs else errs, L)
    bad+=len(errs)
from collections import Counter
print('dist',sorted(Counter(seq).items()),'seq',''.join(seq))
print('adjacent dup', [i for i in range(1,len(seq)) if seq[i]==seq[i-1]])
print('errors',bad)
