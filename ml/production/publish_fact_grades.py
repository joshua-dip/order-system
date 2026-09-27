"""Package explicit AI review decisions; never infer grades from model answers."""
import hashlib
import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CYCLE = ROOT / 'ml/production/cycles/2026-09-27-fact-production'
set_name, phase = sys.argv[1:3]
assert set_name in ('sep26-go1', 'jun11-go2') and phase in ('before', 'after')
label = f'2026-09-27-fact-production-{phase}'
run = ROOT / f'ml/eval/runs/{set_name}/{label}.jsonl'
source = CYCLE / f'{set_name}-sources.json'
decisions = json.loads((CYCLE / f'{set_name}-{phase}-decisions.json').read_text())
rows = [json.loads(line) for line in run.read_text().splitlines()]
sources = json.loads(source.read_text())
expected = 76 if set_name == 'sep26-go1' else 72
key = lambda r: f"{r['num']}|{r['type']}|{r['rep']}"
assert len(rows) == expected and len({key(r) for r in rows}) == expected
assert set(decisions) == {key(r) for r in rows}
assert all(v[0] in 'OPXF' and v[1] for v in decisions.values())
for row in rows:
    assert row['ok'] or decisions[key(row)][0] == 'F'

def counts(items):
    c = Counter(decisions[key(r)][0] for r in items)
    n = len(items)
    return {'n': n, **{g: c[g] for g in 'OPXF'},
            'O_percent': round(100*c['O']/n, 2), 'F_percent': round(100*c['F']/n, 2)}

report = {
    'grader': 'Codex AI direct review; not independent human or blind review',
    'grading_version': 'production-fact-v1',
    'rubric': 'O: source, unique answer, explanation, discrimination pass; P: repair needed including duplicate alternatives/ambiguity; X: wrong key or no defensible key; F: generation failure. Same rubric before and after.',
    'source_run_label': label,
    'run_sha256': hashlib.sha256(run.read_bytes()).hexdigest(),
    'source_material_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
    'experiment': json.loads((CYCLE/'plan.json').read_text()),
    'training_plan': json.loads((CYCLE/'training-plan.json').read_text()),
    'grades': {k: v[0] for k,v in decisions.items()},
    'notes': {k: v[1] for k,v in decisions.items()},
    'review_material': {key(r): {'original': sources[r['num']], **{f: r.get(f) for f in ('num','type','rep','ok','error','options','answer','explanation','warnings','sec')}} for r in rows},
    'generation_trace': {key(r): {'log': r.get('log'), 'trace': r.get('trace')} for r in rows},
    'by_type': {t: counts([r for r in rows if r['type']==t]) for t in ('match','mismatch')},
    'total': counts(rows),
    'cycle_result': {'status': 'pending_comparison', 'product_approved': False},
}
execution = CYCLE/'execution.json'
if execution.exists(): report['execution'] = json.loads(execution.read_text())
out = ROOT / f'ml/eval/grades/{set_name}/{label}.json'
out.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
print(json.dumps({'path':str(out.relative_to(ROOT)), 'total': report['total']}, ensure_ascii=False))
