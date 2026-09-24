#!/usr/bin/env python3
"""저장된 평가 실행의 최종 오답을 35B 로 다시 판정 — 「무관(off_topic)·정답으로도 읽힘(also_correct)·겹침」 수를 센다.

파이프라인 안의 판정은 고치기 전후로 규칙이 달라 숫자를 바로 비교할 수 없다. 이 도구는 두 실행에 같은
판정 문구(distractor_check._verify_sys)를 같은 모델·온도 0으로 대어, 오답 품질을 같은 잣대로 잰다.

  ml/topic/.venv/bin/python ml/eval/judge_distractors.py --set sep26-go1 --label 2026-09-24-current
결과: runs/<세트>/<label>.judge.json  (view.py 가 요약에 보탠다)
35B 한 벌(약 19GB)만 올린다.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EVAL = Path(__file__).resolve().parent
REASONER = "mlx-community/Qwen3.6-35B-A3B-4bit"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--set", default="sep26-go1")
    ap.add_argument("--label", required=True)
    ap.add_argument("--reasoner", default=REASONER)
    args = ap.parse_args()

    sys.path[:0] = [str(ROOT / "ml/common")]
    import mlx_runtime  # noqa: E402
    from distractor_check import _verify_sys  # noqa: E402
    from json_extract import extract_json_object  # noqa: E402
    from pymongo import MongoClient  # noqa: E402

    sys.path.insert(0, str(ROOT / "ml/worker"))
    argv, sys.argv = sys.argv, ["x"]
    import local_variant_worker as w  # noqa: E402
    sys.argv = argv

    spec = json.loads((EVAL / "sets" / f"{args.set}.json").read_text(encoding="utf-8"))
    tb = spec["textbook"]
    rows = [json.loads(ln) for ln in (EVAL / "runs" / args.set / f"{args.label}.jsonl").open(encoding="utf-8")]
    model, tok = mlx_runtime.load_base(args.reasoner)
    db = MongoClient(w.load_env()["MONGODB_URI"], serverSelectionTimeoutMS=20000)["gomijoshua"]
    paras: dict[str, str] = {}
    out = []
    total: dict[str, Counter] = {}
    for r in rows:
        if not r.get("ok"):
            continue
        num = r["num"]
        if num not in paras:
            paras[num] = db.passages.find_one({"textbook": tb, "source_key": f"{tb} {num}"})["content"]["original"]
        correct = [o[1:].strip() for o in r["options"] if o[:1] == r["answer"]]
        ds = [o[1:].strip() for o in r["options"] if o[:1] != r["answer"]]
        if not correct or len(ds) != 4:
            continue
        raw = mlx_runtime.chat_text(
            model, tok, _verify_sys(r["type"]),
            f"[Passage]\n{paras[num]}\n\n[Correct option]\n{correct[0]}\n\n[Distractors]\n"
            + "\n".join(f"{k + 1}. {d}" for k, d in enumerate(ds)) + "\n\nReturn verdicts JSON.",
            max_tokens=500, temp=0.0,
        )
        obj = extract_json_object(raw) or {}
        verdicts = [str(v.get("verdict") or "").lower() for v in obj.get("verdicts", []) if isinstance(v, dict)][:4]
        c = Counter(verdicts)
        total.setdefault(r["type"], Counter()).update(c)
        total[r["type"]]["items"] += 1
        total[r["type"]]["items_2plus_off"] += 1 if c["off_topic"] >= 2 else 0
        out.append({"num": num, "type": r["type"], "rep": r.get("rep", 1), "verdicts": verdicts})
        print(f"{num} {r['type']} {dict(c)}", flush=True)
    summary = {t: dict(c) for t, c in total.items()}
    path = EVAL / "runs" / args.set / f"{args.label}.judge.json"
    path.write_text(json.dumps({"summary": summary, "items": out}, ensure_ascii=False, indent=1), encoding="utf-8")
    for t, c in summary.items():
        print(f"{t:6} 문항 {c.get('items', 0)} · 오답 {4 * c.get('items', 0)} 중 무관 {c.get('off_topic', 0)} · "
              f"정답으로도 읽힘 {c.get('also_correct', 0)} · 겹침 {c.get('duplicate', 0)} · 무관 2개 이상 문항 {c.get('items_2plus_off', 0)}")
    print(f"저장: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
