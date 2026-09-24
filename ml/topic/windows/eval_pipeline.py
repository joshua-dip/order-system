#!/usr/bin/env python3
"""주제 파이프라인 품질 시험 — 개선 루프(고치고 → 같은 시험 세트로 전후 비교)용.

시험 세트: data/topic-finetune/test.jsonl 에서 지문이 겹치지 않게 앞 --k 개
          + data/topic-finetune/eval_extra.jsonl (한 줄에 {"source", "paragraph", "gold"} — 로컬 전용, gitignore)
지문마다 --n 번 돌려 결과를 JSONL 로 남기고 표로 찍는다. 맞음/부분/틀림 채점은 사람이 한다
(overlap 은 기출 정답과 내용어가 얼마나 겹치는지 — 참고용일 뿐 채점이 아니다).

  python eval_pipeline.py --k 5 --n 2 --out eval.jsonl
  python eval_pipeline.py --adapter ..\\adapters\\topic-lora-cuda-1.5b   # 다른 어댑터(베이스·4bit 는 train_meta.json)
  python eval_pipeline.py --code-root <다른 체크아웃>\\ml                # 다른 버전의 파이프라인 코드와 비교
  python eval_pipeline.py --backend mlx --adapter ../adapters/topic-lora  # 맥(MLX) — 맥에선 auto 가 mlx 를 고른다

GPU 를 쓴다 — 워커가 모델을 올려 둔 상태에서 돌리면 4GB 가 모자랄 수 있다(Windows).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

_WIN = Path(__file__).resolve().parent
_ML = _WIN.parent.parent
_ROOT = _ML.parent
_STOP = frozenset(
    "the a an of to in on for and or with from that this these those their there they them its it is are was were "
    "be been being as at by about into than then more most very much many some such not no can could would should "
    "may might must will how why what which who importance idea role need ways way reasons reason".split()
)


def _content(s: str) -> set[str]:
    return {w[:5] for w in re.findall(r"[a-z]+", s.lower()) if len(w) > 2 and w not in _STOP}


def overlap(answer: str, gold: str) -> float:
    a, g = _content(answer), _content(gold)
    return round(len(a & g) / len(g), 2) if a and g else 0.0


def load_cases(data_root: Path, k: int) -> list[dict]:
    cases: list[dict] = []
    seen: set[str] = set()
    test = data_root / "topic-finetune" / "test.jsonl"
    for line in test.read_text(encoding="utf-8").splitlines():
        if len(cases) >= k:
            break
        row = json.loads(line)
        user = row["messages"][1]["content"]
        if user[:300] in seen:
            continue  # 같은 지문이 문항 버전만 바꿔 여러 줄 있다
        seen.add(user[:300])
        gold_qd = json.loads(row["messages"][2]["content"])
        ans = str(gold_qd.get("CorrectAnswer") or "").strip()
        gold = next((o.strip()[1:].strip() for o in str(gold_qd.get("Options")).split("###") if o.strip().startswith(ans)), "")
        passage = user.split("\n", 1)[1].strip()
        cases.append({"source": f"test.jsonl #{len(cases) + 1}", "paragraph": passage, "gold": gold})
    extra = data_root / "topic-finetune" / "eval_extra.jsonl"
    if extra.is_file():
        for line in extra.read_text(encoding="utf-8").splitlines():
            if line.strip():
                cases.append(json.loads(line))
    return cases


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    ap = argparse.ArgumentParser(description="Topic pipeline eval — fixed set, repeated samples")
    ap.add_argument("--k", type=int, default=5, help="test.jsonl 에서 쓸 서로 다른 지문 수")
    ap.add_argument("--n", type=int, default=2, help="지문마다 돌릴 횟수")
    ap.add_argument("--data-root", type=Path, default=_ROOT / "data")
    ap.add_argument("--adapter", type=Path, default=None,
                    help="기본: cuda → adapters/topic-lora-cuda, mlx → adapters/topic-lora")
    ap.add_argument("--backend", choices=("auto", "cuda", "mlx"), default="auto",
                    help="auto = 맥(Apple Silicon)이면 mlx, 아니면 cuda")
    ap.add_argument("--code-root", type=Path, default=_ML, help="파이프라인 코드를 가져올 ml 폴더")
    ap.add_argument("--out", type=Path, default=None, help="결과 JSONL")
    ap.add_argument("--reasoner", default="", help="[mlx] 주장·검증·해설 단계를 맡을 큰 모델 (예: mlx-community/Qwen3.6-35B-A3B-4bit)")
    args = ap.parse_args()

    # 앞에 넣을수록 먼저 찾는다 — 최종 순서: topic/windows → topic → common
    for p in (args.code_root / "common", args.code_root / "topic", args.code_root / "topic" / "windows"):
        sys.path.insert(0, str(p))
    backend = args.backend
    if backend == "auto":
        backend = "mlx" if sys.platform == "darwin" else "cuda"
    if backend == "mlx":
        import mlx_runtime  # noqa: E402

        mlx_runtime.use_as_cuda_runtime()  # 파이프라인이 cuda_runtime 자리에서 MLX 를 쓰게
    import cuda_runtime as rt  # noqa: E402
    import pipeline_topic as pt  # noqa: E402
    if args.adapter is None:
        args.adapter = args.code_root / "topic" / "adapters" / ("topic-lora" if backend == "mlx" else "topic-lora-cuda")

    cases = load_cases(args.data_root, args.k)
    base = rt.load_base_model_name(args.adapter, "Qwen/Qwen2.5-0.5B-Instruct")
    use_4bit = rt.resolve_use_4bit(args.adapter, False)
    t0 = time.time()
    model, tok = rt.load_base(base, use_4bit)
    model = rt.attach_adapters(model, [("topic", args.adapter)])
    if args.reasoner:
        if backend != "mlx":
            raise SystemExit("--reasoner 는 mlx 백엔드에서만 씁니다")
        model = rt.attach_reasoner(model, args.reasoner)
        print(f"[mlx] 추론 모델 {args.reasoner} 붙임 — 주장·검증·해설은 이 모델, 초안은 LoRA", flush=True)
    print(f"[{backend}] 모델 {base} 4bit={use_4bit} 어댑터={args.adapter.name} 로드 {time.time() - t0:.0f}초 · "
          f"코드={args.code_root} · 지문 {len(cases)}개 × {args.n}회", flush=True)

    out = args.out.open("w", encoding="utf-8") if args.out else None
    rows: list[dict] = []
    for ci, case in enumerate(cases, 1):
        for run in range(1, args.n + 1):
            t = time.time()
            res = pt.run_pipeline(model, tok, case["paragraph"], max_retries=2, temp=0.3, main_adapter="topic")
            qd = res.get("question_data") or {}
            opts = [o.strip()[1:].strip() for o in str(qd.get("Options") or "").split("###") if o.strip()]
            ans = str(qd.get("CorrectAnswer") or "")
            answer = opts["①②③④⑤".index(ans)] if ans in "①②③④⑤" and len(opts) == 5 and ans else ""
            row = {
                "case": ci, "run": run, "source": case["source"], "gold": case["gold"],
                "ok": bool(res.get("ok")), "error": res.get("error"), "answer": answer, "options": opts,
                "claim": ((res.get("pipeline") or {}).get("claim") or {}).get("claim_en"),
                "explanation": qd.get("Explanation"), "overlap": overlap(answer, case["gold"]),
                "seconds": round(time.time() - t),
            }
            rows.append(row)
            if out:
                out.write(json.dumps(row, ensure_ascii=False) + "\n")
                out.flush()
            print(f"[{ci}.{run}] {row['seconds']}초 ok={row['ok']} overlap={row['overlap']} · {answer or row['error']}", flush=True)

    print("\n지문별 — 기출 정답 / 생성 정답(겹침)", flush=True)
    for ci, case in enumerate(cases, 1):
        print(f"\n#{ci} {case['source']}\n   기출: {case['gold']}")
        for r in (r for r in rows if r["case"] == ci):
            print(f"   {r['run']}회: ({r['overlap']}) {r['answer'] or '실패: ' + str(r['error'])}")
    done = [r for r in rows if r["ok"]]
    print(f"\n완성 {len(done)}/{len(rows)} · 평균 {sum(r['seconds'] for r in rows) / max(1, len(rows)):.0f}초", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
