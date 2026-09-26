#!/usr/bin/env python3
"""요약 평가 실행을 사람 채점용으로 펼쳐 본다 — 요약문·다섯 쌍(★ 정답)·경고.

  python3 ml/eval/dump_summary.py 2026-09-26-summary-v5-noleak
채점은 grades/sep26-go1/<label>.json 에 {"20번|summary": "O", "20번|summary|2": "P", …} (O·P·X·F).
"""
import json, re, sys
for l in open(f"ml/eval/runs/sep26-go1/{sys.argv[1]}.jsonl"):
    r = json.loads(l)
    if not r["ok"]:
        print(f"### {r['num']} r{r['rep']} 실패"); continue
    summ = r["blanked"].split("\n\n→ ")[-1]
    print(f"### {r['num']} r{r['rep']} 정답 {r['answer']} {r['sec']}s 경고 {len(r['warnings'])}")
    print("  요약:", summ)
    for o in r["options"]:
        print("   ", ("★ " if o[:1] == r["answer"] else "  ") + o)
    for w in r["warnings"]:
        print("  ⚠", w[:150])
