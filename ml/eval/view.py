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
import re
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


def _pct(a: float, b: float) -> str:
    return f"{100 * a / b:5.1f}%" if b else "   -  "


def report(set_name: str, labels: list[str]) -> dict:
    """버전별 성적표(%) — 사람 채점(정답 적절률) + 자동 지표 + 오답 재판정. 표로 찍고 dict 로 돌려준다."""
    board: dict = {}
    for lb in labels:
        rows = load_rows(set_name, lb)
        gpath = EVAL / "grades" / set_name / f"{lb}.json"
        grades = json.loads(gpath.read_text(encoding="utf-8"))["grades"] if gpath.is_file() else {}
        # 순서를 바꿔 두 번 판정한 judge2 가 있으면 그것을 쓴다(채점관의 순서 편향을 뺀 값, 노트 16과)
        jpath = EVAL / "runs" / set_name / f"{lb}.judge2.json"
        if not jpath.is_file():
            jpath = EVAL / "runs" / set_name / f"{lb}.judge.json"
        judge = json.loads(jpath.read_text(encoding="utf-8"))["summary"] if jpath.is_file() else {}
        per: dict = {}
        for t in ("topic", "title", "claim", "match", "mismatch", "blank", "all"):
            rs = [r for r in rows if t == "all" or r["type"] == t]
            gs = [g for k, g in grades.items() if t == "all" or k.split("|")[1] == t]
            n_ok = sum(1 for r in rs if r["ok"])
            form = 0
            for r in rs:
                ans = [o[1:].strip() for o in r["options"] if o[:1] == r["answer"]]
                chk = topic_form_issue if r["type"] == "topic" else title_form_issue if r["type"] == "title" else None
                if chk and ans and chk(ans[0]):
                    form += 1
            js = [judge[k] for k in judge if t == "all" or k == t]
            items = sum(j.get("items", 0) for j in js if "fact_ok" not in j)
            per[t] = {
                "n": len(rs),
                "correct": sum(1 for g in gs if g == "O") / len(gs) if gs else None,
                "correct_or_partial": sum(1 for g in gs if g in ("O", "P")) / len(gs) if gs else None,
                "generated": n_ok / len(rs) if rs else None,
                "bad_shape": form / len(rs) if rs else None,
                "off_topic": sum(j.get("off_topic", 0) for j in js) / (4 * items) if items else None,
                "also_correct": sum(j.get("also_correct", 0) for j in js) / (4 * items) if items else None,
                "off_topic_2plus": sum(j.get("items_2plus_off", 0) for j in js) / items if items else None,
                "fact_ok": (sum(j.get("fact_ok", 0) for j in js) / sum(j.get("items", 0) for j in js if "fact_ok" in j))
                if any("fact_ok" in j for j in js) else None,
                "sec": statistics.mean(r["sec"] for r in rs) if rs else None,
                "judge_agree": (sum(j.get("judge_agree", 0) for j in js) / sum(j.get("judge_pairs", 0) for j in js))
                if sum(j.get("judge_pairs", 0) for j in js) else None,
            }
        board[lb] = per

    def w(text: str) -> int:  # 화면 폭 — 한글은 두 칸
        return sum(2 if "\uac00" <= ch <= "\ud7a3" else 1 for ch in text)

    def ljust(text: str, n: int) -> str:
        return text + " " * max(0, n - w(text))

    short = {lb: re.sub(r"^\d{4}-\d{2}-\d{2}-", "", lb) for lb in labels}

    def cell(v, pct=True):
        if v is None:
            return "     -"
        return f"{100 * v:5.1f}%" if pct else f"{v:5.1f}s"

    rows_spec = [("정답 적절(맞음)", "correct", True), ("맞음+부분", "correct_or_partial", True),
                 ("생성 성공", "generated", True), ("규칙 재확인 통과(일치·불일치·빈칸)", "fact_ok", True),
                 ("모양 틀린 정답 ↓", "bad_shape", True),
                 ("무관 오답 ↓", "off_topic", True), ("무관 오답 2개+ 문항 ↓", "off_topic_2plus", True),
                 ("정답으로도 읽히는 오답 ↓", "also_correct", True),
                 ("채점관 두 순서 판정 일치", "judge_agree", True),
                 ("문항당 시간 ↓", "sec", False)]
    present = {t for lb in labels for t in board[lb] if board[lb][t]["n"]}
    for t in [x for x in ("all", "topic", "title", "claim", "match", "mismatch", "blank") if x in present]:
        name = {"all": "전체", "topic": "주제", "title": "제목", "claim": "주장", "match": "일치", "mismatch": "불일치", "blank": "빈칸"}[t]
        print("\n" + ljust(f"[{name}]", 26) + "".join(f"{short[lb]:>12}" for lb in labels))
        for label, key, pct in rows_spec:
            print(f"  {ljust(label, 24)}" + "".join(f"{cell(board[lb][t][key], pct):>12}" for lb in labels))
        print(f"  {ljust('문항 수', 24)}" + "".join(f"{board[lb][t]['n']:>12}" for lb in labels))
    print("\n↓ 는 낮을수록 좋음. 정답 적절은 사람 채점, 재확인·오답 지표는 judge_distractors.py(35B 온도 0, judge2 = 순서 바꿔 두 번) 재판정.")
    return board


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--set", default="sep26-go1")
    ap.add_argument("--label", default="")
    ap.add_argument("--types", default="")
    ap.add_argument("--summary", action="store_true")
    ap.add_argument("--compare", default="", help="label,label — 사람 채점 합계를 나란히")
    ap.add_argument("--report", default="", help="label,label,… — 버전별 성적표(%)")
    ap.add_argument("--json", default="", help="--report 결과를 이 파일에 저장")
    args = ap.parse_args()

    if args.report:
        board = report(args.set, args.report.split(","))
        if args.json:
            Path(args.json).write_text(json.dumps(board, ensure_ascii=False, indent=1), encoding="utf-8")
        return 0

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
    judge = EVAL / "runs" / args.set / f"{args.label}.judge2.json"
    if not judge.is_file():
        judge = EVAL / "runs" / args.set / f"{args.label}.judge.json"
    if judge.is_file():
        print("[오답 재판정 — judge_distractors.py, 35B 온도 0]")
        for t, c in json.loads(judge.read_text(encoding="utf-8"))["summary"].items():
            n = c.get("items", 0)
            print(f"  {t:6} 오답 {4 * n} 중 무관 {c.get('off_topic', 0)} · 정답으로도 읽힘 {c.get('also_correct', 0)} · "
                  f"겹침 {c.get('duplicate', 0)} · 무관 2개 이상 문항 {c.get('items_2plus_off', 0)}/{n}")
    gs = grade_summary(args.set, args.label)
    if gs:
        print("[사람 채점] 맞음/부분/틀림/실패")
        for t, c in gs.items():
            print(f"  {t:6} {c['O']}/{c['P']}/{c['X']}/{c['F']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
