#!/usr/bin/env python3
"""고정 평가 세트로 주제·제목·주장 파이프라인을 돌린다 — 고칠 때마다 같은 시험을 본다(노트 6·13과).

  ml/topic/.venv/bin/python ml/eval/run_eval.py --set sep26-go1 --label after-x [--repeat 2] [--types claim] [--nums 20번,30번]

지문은 세트의 textbook + 번호로 DB(passages)에서 읽는다(원문은 저장소에 두지 않음).
결과는 ml/eval/runs/<세트>/<label>.jsonl (gitignore). 채점·요약은 view.py.
워커와 같은 모델(7B + 유형 LoRA + 35B 추론)을 따로 올리므로 메모리 약 34GB — 워커가 모델을 올린 채면 겹친다.
"""
from __future__ import annotations

import argparse
import contextlib
import importlib.util
import io
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EVAL = Path(__file__).resolve().parent
KO = {"topic": "주제", "title": "제목", "claim": "주장", "match": "일치", "mismatch": "불일치", "blank": "빈칸", "order": "순서", "insert": "삽입",
      "irrelevant": "무관한문장", "vocab": "어휘", "grammar": "어법"}
# 평가 유형 → ml/ 폴더(파이프라인·어댑터). 일치·불일치는 fact 하나를 kind 로 나눠 쓴다
MODULE = {"topic": "topic", "title": "title", "claim": "claim", "match": "fact", "mismatch": "fact", "blank": "blank",
          "order": "order", "insert": "insert", "irrelevant": "irrelevant", "vocab": "vocab", "grammar": "grammar"}
RULE_MODULES = {"order", "insert", "irrelevant", "vocab", "grammar"}  # 어댑터 없는 규칙 유형
BASE = "mlx-community/Qwen2.5-7B-Instruct-4bit"
REASONER = "mlx-community/Qwen3.6-35B-A3B-4bit"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--set", default="sep26-go1")
    ap.add_argument("--label", required=True, help="이 실행의 이름 — 예: 2026-09-24-final")
    ap.add_argument("--types", default="", help="topic,title,claim 중 일부(기본: 세트 전부)")
    ap.add_argument("--nums", default="", help="20번,30번 처럼 일부 지문만")
    ap.add_argument("--repeat", type=int, default=1, help="같은 문항을 몇 번 돌릴지 — 운의 몫을 줄이려면 2~3")
    ap.add_argument("--reasoner", default=REASONER)
    args = ap.parse_args()

    spec = json.loads((EVAL / "sets" / f"{args.set}.json").read_text(encoding="utf-8"))
    types = [t for t in (args.types.split(",") if args.types else spec["types"]) if t]
    nums = args.nums.split(",") if args.nums else [p["num"] for p in spec["passages"]]
    out_dir = EVAL / "runs" / args.set
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{args.label}.jsonl"

    sys.path[:0] = [str(ROOT / "ml/common")]
    import mlx_runtime  # noqa: E402

    mlx_runtime.use_as_cuda_runtime()
    import cuda_runtime as rt  # noqa: E402
    from pymongo import MongoClient  # noqa: E402

    sys.path.insert(0, str(ROOT / "ml/worker"))
    argv, sys.argv = sys.argv, ["x"]  # 워커 모듈이 import 때 argv 를 읽는다
    import local_variant_worker as w  # noqa: E402
    sys.argv = argv

    mods: dict = {}

    def load(en: str):
        if en not in mods:
            for p in (ROOT / "ml" / en, ROOT / "ml" / en / "windows"):
                sys.path.insert(0, str(p))
            sys.modules.pop("_cuda_runtime", None)
            sp = importlib.util.spec_from_file_location(f"pipeline_{en}", ROOT / "ml" / en / "windows" / f"pipeline_{en}.py")
            m = importlib.util.module_from_spec(sp)
            sp.loader.exec_module(m)
            mods[en] = m
        return mods[en]

    model, tok = rt.load_base(BASE)
    mods_needed = sorted({MODULE[t] for t in types} - RULE_MODULES)
    model = rt.attach_adapters(model, [(m, ROOT / f"ml/{m}/adapters/{m}-lora") for m in mods_needed])
    model = rt.attach_reasoner(model, args.reasoner)
    db = MongoClient(w.load_env()["MONGODB_URI"], serverSelectionTimeoutMS=20000)["gomijoshua"]
    tb = spec["textbook"]

    def gold(num: str, ko: str) -> list[str]:
        """DB 에 있는 같은 지문·유형 완료 문항의 정답 — 채점할 때 곁눈질용."""
        out = []
        for g in db.generated_questions.find({"textbook": tb, "source": f"{tb} {num}", "type": ko, "status": "완료"},
                                             {"question_data.Options": 1, "question_data.CorrectAnswer": 1}).limit(3):
            qd = g.get("question_data") or {}
            opts = [o.strip() for o in str(qd.get("Options") or "").replace("\n", "###").split("###") if o.strip()]
            hit = [o for o in opts if o.startswith(str(qd.get("CorrectAnswer") or "@"))]
            if hit:
                out.append(hit[0])
        return out

    with out_path.open("a", encoding="utf-8") as out:
        for rep in range(1, args.repeat + 1):
            for num in nums:
                doc = db.passages.find_one({"textbook": tb, "source_key": f"{tb} {num}"})
                if not doc:
                    print(f"지문 없음: {tb} {num}", file=sys.stderr)
                    continue
                para = doc["content"]["original"]
                p_types = next((p.get("types") for p in spec["passages"] if p["num"] == num), None)
                for en in [t for t in types if not p_types or t in p_types]:
                    mod = load(MODULE[en])
                    extra = {"kind": KO[en]} if MODULE[en] == "fact" else {}
                    t0 = time.time()
                    err = io.StringIO()
                    with contextlib.redirect_stderr(err):
                        try:
                            r = mod.run_pipeline(model, tok, para, max_retries=2, temp=0.3, main_adapter=MODULE[en], **extra)
                        except Exception as e:  # noqa: BLE001
                            r = {"ok": False, "error": f"{type(e).__name__}: {e}"}
                    qd = r.get("question_data") or {}
                    row = {
                        "num": num, "type": en, "rep": rep, "sec": round(time.time() - t0, 1),
                        "ok": r.get("ok"), "error": r.get("error"),
                        "options": [o.strip() for o in str(qd.get("Options") or "").split("###") if o.strip()],
                        "answer": qd.get("CorrectAnswer"), "explanation": qd.get("Explanation"),
                        "warnings": r.get("warnings") or [], "gold": gold(num, KO[en]),
                        # 빈칸은 재판정에 빈칸 뚫린 지문이 필요하다
                        "blanked": qd.get("Paragraph") if en in ("blank", "order", "insert", "irrelevant", "vocab", "grammar") else None,
                        "log": [ln for ln in err.getvalue().splitlines() if "[pipeline]" in ln],
                        "trace": r.get("trace") if not r.get("ok") else None,
                    }
                    out.write(json.dumps(row, ensure_ascii=False) + "\n")
                    out.flush()
                    print(f"[{rep}] {num} {en} {row['sec']}s ok={row['ok']} 경고={len(row['warnings'])}", flush=True)
    print(f"저장: {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
