#!/usr/bin/env python3
"""저장된 평가 실행을 35B 로 다시 판정 — 버전마다 규칙이 다른 파이프라인 안 판정 대신 고정된 잣대로 잰다.

  주제·제목·주장 : 오답마다 무관(off_topic)·정답으로도 읽힘(also_correct)·겹침(duplicate)
  일치·불일치    : 사실 재확인 — 정답 1개 규칙(일치=참1·거짓4, 불일치=거짓1·참4)을 지키나
  빈칸           : 넣어 보기 재확인 — 맞는(fits) 선지가 정답 하나뿐이고 오답은 모두 wrong 인가

채점관(35B)도 선지가 놓인 순서에 따라 판정이 달라진다(노트 16과 ④ — 섞은 순서로 재채점하자 빈칸 통과율이
80.6% → 68.6% 로 떨어졌지만 사람 채점은 같았다). 그래서 기본은 **순서를 바꿔 두 번**(--orders 2):
  규칙 통과(일치·불일치·빈칸) = 두 순서 모두 통과해야 통과
  오답 지표(주제·제목·주장)   = 두 순서의 평균
  judge_agree                 = 두 순서의 판정이 선지 단위로 같았던 비율 — 채점관이 얼마나 흔들리는지

  ml/topic/.venv/bin/python ml/eval/judge_distractors.py --set sep26-go1 --label 2026-09-25-blank-v2
결과: runs/<세트>/<label>.judge2.json (--orders 1 이면 예전 형식 <label>.judge.json). view.py 가 judge2 를 먼저 쓴다.
35B 한 벌(약 19GB)만 올린다.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Callable

ROOT = Path(__file__).resolve().parents[2]
EVAL = Path(__file__).resolve().parent
REASONER = "mlx-community/Qwen3.6-35B-A3B-4bit"
CIRCLED = "①②③④⑤"


def _load(name: str, path: Path) -> Any:
    sp = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(sp)
    sp.loader.exec_module(mod)
    return mod


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--set", default="sep26-go1")
    ap.add_argument("--label", required=True)
    ap.add_argument("--reasoner", default=REASONER)
    ap.add_argument("--orders", type=int, default=2, choices=(1, 2), help="1=주어진 순서만(예전), 2=뒤집은 순서까지")
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

    pf = _load("pipeline_fact", ROOT / "ml/fact/windows/pipeline_fact.py")
    pb = _load("pipeline_blank", ROOT / "ml/blank/windows/pipeline_blank.py")
    spec = json.loads((EVAL / "sets" / f"{args.set}.json").read_text(encoding="utf-8"))
    tb = spec["textbook"]
    rows = [json.loads(ln) for ln in (EVAL / "runs" / args.set / f"{args.label}.jsonl").open(encoding="utf-8")]
    model, tok = mlx_runtime.load_base(args.reasoner)
    db = MongoClient(w.load_env()["MONGODB_URI"], serverSelectionTimeoutMS=20000)["gomijoshua"]
    paras: dict[str, str] = {}

    def ask(system: str, head: str, label: str, items: list[str], order: list[int], tail: str,
            parse: Callable[[dict | None], list | None]) -> list | None:
        """items 를 order 순서로 번호 매겨 묻고, 판정을 원래 위치로 되돌려 준다."""
        raw = mlx_runtime.chat_text(
            model, tok, system,
            f"{head}\n\n[{label}]\n" + "\n".join(f"{k + 1}. {items[j]}" for k, j in enumerate(order)) + f"\n\n{tail}",
            max_tokens=600, temp=0.0,
        )
        got = parse(extract_json_object(raw))
        if got is None or len(got) < len(order):
            return None
        back: list = [None] * len(order)
        for k, j in enumerate(order):
            back[j] = got[k]
        return back

    orders_for = (lambda n: [list(range(n)), list(range(n))[::-1]][: args.orders])
    out = []
    total: dict[str, Counter] = {}
    for r in rows:
        if not r.get("ok"):
            continue
        num, typ = r["num"], r["type"]
        if typ in ("order", "insert", "irrelevant", "vocab", "grammar"):
            continue  # 규칙 유형은 파이프라인이 이미 35B 모의 풀이로 거른다 — 같은 모델로 재채점해도 뜻이 없어 사람 채점으로 본다
        if num not in paras:
            paras[num] = db.passages.find_one({"textbook": tb, "source_key": f"{tb} {num}"})["content"]["original"]
        c = Counter()

        if typ in ("match", "mismatch", "blank"):
            opts = [o[1:].strip() for o in r["options"]]
            if len(opts) != 5 or r["answer"] not in CIRCLED or (typ == "blank" and not r.get("blanked")):
                continue
            ans = CIRCLED.index(r["answer"])
            runs = []
            for order in orders_for(5):
                if typ == "blank":
                    v = ask(pb.CHECK_SYS, f"[Passage]\n{r['blanked']}", "Options", opts, order,
                            "Return checks JSON.", pb._verdicts)
                    bad = pb._problems(v, ans) if v else None
                    runs.append((v, bad))
                else:
                    v = ask(pf.CHECK_SYS, f"[Passage]\n{paras[num]}", "Options", opts, order,
                            "Return checks JSON.", pf._verdicts)
                    kind = "일치" if typ == "match" else "불일치"
                    bad = pf._problems(kind, v, ans) if v else None
                    runs.append(([x["verdict"] for x in v] if v else None, bad))
            verdict_lists = [v for v, _ in runs]
            c["items"] += 1
            c["fact_ok"] += 1 if all(b == {} for _, b in runs) else 0  # 두 순서 모두 통과해야
            c["fact_ok_first_order"] += 1 if runs[0][1] == {} else 0
            c["fact_unreadable"] += 1 if any(v is None for v in verdict_lists) else 0
            c["fact_answer_wrong"] += 1 if any(b and ans in b for _, b in runs) else 0
            c["fact_distractor_bad"] += len({i for _, b in runs for i in (b or {}) if i != ans})
            if len(runs) == 2 and all(verdict_lists):
                c["judge_pairs"] += 5
                c["judge_agree"] += sum(1 for a, b in zip(*verdict_lists) if a == b)
            total.setdefault(typ, Counter()).update(c)
            out.append({"num": num, "type": typ, "rep": r.get("rep", 1), "verdicts": verdict_lists})
            print(f"{num} {typ} ok={all(b == {} for _, b in runs)} "
                  + " / ".join("".join(x[0].upper() for x in v) if v else "?" for v in verdict_lists), flush=True)
            continue

        correct = [o[1:].strip() for o in r["options"] if o[:1] == r["answer"]]
        ds = [o[1:].strip() for o in r["options"] if o[:1] != r["answer"]]
        if not correct or len(ds) != 4:
            continue

        def parse_d(obj: dict | None) -> list | None:
            rows_ = obj.get("verdicts") if isinstance(obj, dict) else None
            if not isinstance(rows_, list):
                return None
            return [str((x or {}).get("verdict") or "").lower() if isinstance(x, dict) else "" for x in rows_][:4]

        per_order = []
        for order in orders_for(4):
            v = ask(_verify_sys(typ), f"[Passage]\n{paras[num]}\n\n[Correct option]\n{correct[0]}", "Distractors", ds,
                    order, "Return verdicts JSON.", parse_d)
            if v is not None:
                per_order.append(v)
        if not per_order:
            continue
        n = len(per_order)
        # 두 순서의 평균 — 합계를 순서 수로 나눠 「문항 수 × 4」 분모에 맞춘다(소수 허용)
        for v in per_order:
            cv = Counter(v)
            for k2 in ("off_topic", "also_correct", "duplicate"):
                c[k2] += cv[k2] / n
            c["items_2plus_off"] += (1 if cv["off_topic"] >= 2 else 0) / n
        c["items"] += 1
        if n == 2:
            c["judge_pairs"] += 4
            c["judge_agree"] += sum(1 for a, b in zip(*per_order) if a == b)
        total.setdefault(typ, Counter()).update(c)
        out.append({"num": num, "type": typ, "rep": r.get("rep", 1), "verdicts": per_order})
        print(f"{num} {typ} " + " / ".join(str(dict(Counter(v))) for v in per_order), flush=True)

    summary = {t: {k: round(v, 3) if isinstance(v, float) else v for k, v in c.items()} for t, c in total.items()}
    name = f"{args.label}.judge2.json" if args.orders == 2 else f"{args.label}.judge.json"
    path = EVAL / "runs" / args.set / name
    path.write_text(json.dumps({"orders": args.orders, "summary": summary, "items": out}, ensure_ascii=False, indent=1),
                    encoding="utf-8")
    for t, c in summary.items():
        agree = f" · 두 순서 판정 일치 {c['judge_agree'] / c['judge_pairs']:.0%}" if c.get("judge_pairs") else ""
        if "fact_ok" in c:
            print(f"{t:8} 문항 {c['items']} · 규칙 통과(두 순서 모두) {c['fact_ok']} · 첫 순서만 보면 {c['fact_ok_first_order']} · "
                  f"정답이 규칙에 어긋남 {c.get('fact_answer_wrong', 0)}{agree}")
            continue
        print(f"{t:6} 문항 {c.get('items', 0)} · 오답 무관 {c.get('off_topic', 0):.1f} · 정답으로도 읽힘 {c.get('also_correct', 0):.1f} · "
              f"무관 2개+ 문항 {c.get('items_2plus_off', 0):.1f}{agree}")
    print(f"저장: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
