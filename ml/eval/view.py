#!/usr/bin/env python3
"""평가 실행 결과 보기 · 자동 지표 · 사람 채점 합계.

  python3 ml/eval/view.py --set sep26-go1 --label 2026-09-24-final            # 문항 전부 + 요약
  python3 ml/eval/view.py --set sep26-go1 --label X --types title --summary    # 요약만
  python3 ml/eval/view.py --set sep26-go1 --compare 2026-09-24-baseline,2026-09-24-final   # 채점 비교

자동 지표(사람 없이 셈): 생성 성공률·평균 시간·경고 수·정답 이동·겹치는 오답 쌍.
사람 채점은 grades/<세트>/<label>.json — {"20번|topic": "O", …} (O 맞음 · P 부분 · X 틀림 · F 실패, 반복이면 "20번|topic|2").
"""
from __future__ import annotations

import argparse
import itertools
import json
import statistics
import sys
from collections import Counter
from pathlib import Path

EVAL = Path(__file__).resolve().parent
sys.path.insert(0, str(EVAL.parent / "common"))
from distractor_check import NEAR_DUP, word_overlap  # noqa: E402
from option_form import title_form_issue, topic_form_issue  # noqa: E402


def load_rows(set_name: str, label: str) -> list[dict]:
    path = EVAL / "runs" / set_name / f"{label}.jsonl"
    return [json.loads(line) for line in path.open(encoding="utf-8")]


def auto_metrics(rows: list[dict]) -> None:
    for t in sorted({r["type"] for r in rows}):
        rs = [r for r in rows if r["type"] == t]
        ok = [r for r in rs if r["ok"]]
        form = 0
        dups = 0
        for r in ok:
            ans = [o[1:].strip() for o in r["options"] if o[:1] == r["answer"]]
            chk = topic_form_issue if t == "topic" else title_form_issue if t == "title" else None
            if chk and ans and chk(ans[0]):
                form += 1
            ds = [o for o in r["options"] if o[:1] != r["answer"]]
            dups += sum(1 for a, b in itertools.combinations(ds, 2) if word_overlap(a, b) >= NEAR_DUP)
        moved = sum(1 for r in rs if any("answer moved" in ln for ln in r["log"]))
        warn = sum(1 for r in rs if r["warnings"])
        secs = [r["sec"] for r in rs]
        print(f"  {t:6} 성공 {len(ok)}/{len(rs)} · 평균 {statistics.mean(secs):.1f}초(최대 {max(secs):.0f}) · "
              f"경고 붙은 문항 {warn} · 정답 이동 {moved} · 모양 틀린 정답 {form} · 겹치는 오답 쌍 {dups}")


def grade_summary(set_name: str, label: str) -> dict[str, Counter]:
    path = EVAL / "grades" / set_name / f"{label}.json"
    if not path.is_file():
        return {}
    grades = json.loads(path.read_text(encoding="utf-8"))["grades"]
    out: dict[str, Counter] = {}
    for key, g in grades.items():
        out.setdefault(key.split("|")[1], Counter())[g] += 1
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--set", default="sep26-go1")
    ap.add_argument("--label", default="")
    ap.add_argument("--types", default="")
    ap.add_argument("--summary", action="store_true")
    ap.add_argument("--compare", default="", help="label,label — 사람 채점 합계를 나란히")
    args = ap.parse_args()

    if args.compare:
        labels = args.compare.split(",")
        sums = {lb: grade_summary(args.set, lb) for lb in labels}
        print(f"{'유형':6} " + " ".join(f"{lb:>28}" for lb in labels) + "   (맞음/부분/틀림/실패)")
        for t in ("topic", "title", "claim"):
            cells = []
            for lb in labels:
                c = sums[lb].get(t, Counter())
                cells.append(f"{c['O']:>2}/{c['P']:>2}/{c['X']:>2}/{c['F']:>2}".rjust(28))
            print(f"{t:6} " + " ".join(cells))
        return 0

    rows = load_rows(args.set, args.label)
    types = set(args.types.split(",")) if args.types else None
    if types:
        rows = [r for r in rows if r["type"] in types]
    spec = json.loads((EVAL / "sets" / f"{args.set}.json").read_text(encoding="utf-8"))
    keys = {p["num"]: p for p in spec["passages"]}
    if not args.summary:
        for r in rows:
            print(f"\n=== {r['num']} {r['type']} (반복 {r.get('rep', 1)}) · {r['sec']}s · ok={r['ok']} {r.get('error') or ''}")
            print(f"    기준: {keys.get(r['num'], {}).get('key', '')}")
            for o in r["options"]:
                print("   ", o, "  ← 정답" if o[:1] == r["answer"] else "")
            for g in r["gold"][:2]:
                print("    [DB]", g)
            for x in r["warnings"]:
                print("    ⚠", x[:200])
    print(f"\n[자동 지표] {args.label}")
    auto_metrics(rows)
    gs = grade_summary(args.set, args.label)
    if gs:
        print("[사람 채점] 맞음/부분/틀림/실패")
        for t, c in gs.items():
            print(f"  {t:6} {c['O']}/{c['P']}/{c['X']}/{c['F']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
