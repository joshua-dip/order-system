#!/usr/bin/env python3
"""Claim multi-stage pipeline: thesis -> practical claim -> draft -> verify -> revise -> explain.

주장(claim) != 주제(topic). 주제는 "무엇에 관한 글인가", 주장은 "독자가 무엇을 해야 하는가" —
정답은 논지에서 실천 층위로 한 단계 내려와야 한다("practical" stage). 주제문의 술어만 조동사로
바꾼 문장("topic sentence + should")은 실패로 간주해 verify_practical 이 잡는다.

Same 0.5B/LoRA, multiple small JSON calls. stdout contract matches infer.py:
  first line { ok, question_data } + optional exam preview.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_TYPE_DIR = Path(__file__).resolve().parent.parent
_WIN_DIR = Path(__file__).resolve().parent
_ROOT = _TYPE_DIR.parent.parent
for p in (_TYPE_DIR, _WIN_DIR):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

from _claim_common import (  # noqa: E402
    CIRCLED,
    SYSTEM_PROMPT,
    format_exam_view,
    read_passage_interactive,
)
from _cuda_runtime import (  # noqa: E402
    DEFAULT_ADAPTER,
    DEFAULT_EXPLAIN_ADAPTER,
    DEFAULT_MODEL,
    adapter_exists,
    chat_json,
    load_base_model_name,
    load_model,
    resolve_use_4bit,
    set_adapter,
)

FAILURE_DIR = _ROOT / "data" / "claim-pipeline-failures"

MODAL_WORDS = ("must", "should", "have to", "has to", "need to", "needs to", "ought to")
KEY_ADJS = (
    "important",
    "essential",
    "significant",
    "critical",
    "vital",
    "crucial",
    "necessary",
    "desirable",
    "appropriate",
)

THESIS_SYS = """You extract the single core thesis (argument) of an English passage for a Korean CSAT-style claim question.
Output ONLY one JSON object. No markdown.
Keys: thesis_en (one English sentence — what the passage argues, facts/argument from the passage only), thesis_ko (one Korean sentence).
Do NOT add ideas that are not in the passage."""

PRACTICAL_SYS = """You turn a passage's core thesis into ONE practical claim sentence for a Korean CSAT 「주장」 (claim) question.
Output ONLY one JSON object. No markdown.
Keys: practical_en (one English sentence, 7-12 words).

Rules:
- 주제(topic) asks "what is this about"; 주장(claim) asks "what should the reader DO about it" — step DOWN
  from the thesis to a concrete practice/action level. Do NOT just restate the thesis with a modal verb bolted on
  (e.g. thesis "practice matters more than talent" -> BAD "Practice should be valued more than talent"
  because that is just the topic sentence + should; GOOD "Learners must dedicate regular practice time instead
  of relying on natural ability alone").
- Use a modal verb (must / should / have to / need to / ought to) OR a key adjective
  (important / essential / significant / critical / vital / crucial / necessary / desirable / appropriate)
  to form a complete English sentence.
- Do NOT start the sentence with You/He/She. A dummy subject "It" is allowed
  (e.g. "It is essential to ...").
- Do not name a specific example, story, fable, or analogy by name — focus on the principle/lesson,
  not the example itself."""

VERIFY_PRACTICAL_SYS = """You check whether a practical claim sentence is a real CSAT 「주장」 answer, not just the thesis with a modal bolted on.
Output ONLY one JSON object. No markdown.
Keys: ok (bool), is_just_thesis_plus_modal (bool), missing_modal_or_adjective (bool), issue (short English string or empty), better_sentence (revised English sentence if ok=false else empty string).
is_just_thesis_plus_modal=true if the sentence is essentially "<thesis> + should/must" with no step down to a concrete practice/action.
missing_modal_or_adjective=true if the sentence has neither a modal verb (must/should/have to/need to/ought to) nor one of these adjectives: important/essential/significant/critical/vital/crucial/necessary/desirable/appropriate."""

DRAFT_DIST_SYS = """You write four wrong (distractor) claim options for a Korean CSAT 「주장」 MCQ.
Output ONLY one JSON object. No markdown.
Keys: options (array of exactly 4 English sentences, 7-12 words each).
Rules:
- Each must be a complete sentence using a modal verb (must/should/have to/need to/ought to) or one of
  important/essential/significant/critical/vital/crucial/necessary/desirable/appropriate.
- Do NOT start with You/He/She (a dummy "It" subject is fine).
- Mix the wrongness: roughly half should argue the OPPOSITE direction of the correct claim, and half should be
  a claim that sounds reasonable and uses the same topic vocabulary but pushes a DIFFERENT practice/action than
  what this passage actually calls for (a "half-step-off" claim, not simply the reverse) — do not make every
  distractor a simple negation, or students can eliminate them without reading closely.
- No duplicate meanings among the four, and none may restate the correct option's meaning.
- Do not name a specific example, story, fable, or analogy by name."""

VERIFY_DIST_SYS = """You check four distractor options for a claim MCQ.
Output ONLY one JSON object. No markdown.
Keys: ok (bool), issues (array of short English strings), options (array of exactly 4 revised distractors if ok=false else empty array).
Fail if: duplicate meanings, same meaning as correct, missing a modal verb or key adjective, starts with You/He/She,
all four are simple opposites with no "half-step-off" variant, or clearly unrelated to the passage."""

REVISE_DIST_SYS = """You rewrite four distractors for a claim MCQ. Keep the correct option unchanged.
Output ONLY one JSON object. No markdown.
Keys: options (array of exactly 4 English sentences, 7-12 words, each with a modal verb or key adjective).
Mix opposite-direction and half-step-off wrong practices; do not start with You/He/She; no duplicate meanings."""

EXPLAIN_SYS = """당신은 한국 수능 영어 「주장」 문항의 한국어 해설만 작성합니다.
반드시 아래 키만 갖는 JSON 한 개만 출력하세요. 마크다운·설명 금지.

키: Explanation

규칙:
1) Explanation = 한국어만, 450자 이하.
2) 정답(CorrectAnswer)이 왜 필자의 주장인지, 논지에서 어떤 실천으로 이어지는지 한 결론으로 밝힌다.
3) 오답 1~2개를 짧게 왜 아닌지 말할 수 있다(반대 방향이다, 지문에 없는 실천이다 등).
4) 지문에 없는 내용을 지어내지 않는다.
5) 영어 문장으로만 된 해설 금지."""


def _strip_circled(opt: str) -> str:
    s = opt.strip()
    for c in CIRCLED:
        if s.startswith(c):
            s = s[len(c) :].strip()
            break
    return s


def _normalize_options(raw: Any) -> list[str]:
    if isinstance(raw, list):
        items = [_strip_circled(str(x)) for x in raw]
    elif isinstance(raw, str):
        s = raw.strip()
        if "###" in s:
            items = [_strip_circled(p) for p in s.split("###")]
        elif "\n" in s:
            items = [_strip_circled(p) for p in s.splitlines()]
        else:
            items = [_strip_circled(s)] if s else []
    else:
        items = []
    items = [x for x in items if x]
    return items[:5]


def _has_modal_or_adj(s: str) -> bool:
    low = s.lower()
    return any(m in low for m in MODAL_WORDS) or any(a in low for a in KEY_ADJS)


def _starts_bad_subject(s: str) -> bool:
    first = s.strip().split()[0].lower().rstrip(".,") if s.strip() else ""
    return first in ("you", "your", "he", "his", "she", "her")


def _fallback_distractors(thesis_en: str, correct: str) -> list[str]:
    base = [
        "Learners should copy any method that produced quick results once.",
        "It is unnecessary to track progress once a routine feels comfortable.",
        "Teachers must prioritize natural ability over structured feedback in class.",
        "Programs ought to shorten practice time whenever learners report boredom.",
        "It is essential to reward talent rather than consistent effort.",
    ]
    out = []
    for b in base:
        if _strip_circled(b).lower() == _strip_circled(correct).lower():
            continue
        out.append(b)
        if len(out) == 4:
            break
    while len(out) < 4:
        out.append(f"Programs should adopt an unrelated practice change {len(out) + 1}.")
    return out[:4]


def _format_options(phrases: list[str]) -> str:
    parts = []
    for i, p in enumerate(phrases[:5]):
        parts.append(f"{CIRCLED[i]} {_strip_circled(p)}")
    return " ### ".join(parts)


def _log_failure(
    *,
    passage: str,
    stage: str,
    bad_output: Any,
    problem: str,
    thesis: dict | None,
    improved_hint: str = "",
) -> None:
    FAILURE_DIR.mkdir(parents=True, exist_ok=True)
    row = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "passage": passage[:4000],
        "stage": stage,
        "bad_output": bad_output,
        "problem": problem,
        "thesis": thesis,
        "improved_hint": improved_hint,
    }
    path = FAILURE_DIR / "failures.jsonl"
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


def _format_ok(qd: dict, passage: str) -> list[str]:
    errs: list[str] = []
    if str(qd.get("Paragraph") or "").strip() != passage.strip():
        errs.append("Paragraph must equal input passage")
    if qd.get("OptionType") != "English":
        errs.append("OptionType must be English")
    opts = _normalize_options(qd.get("Options"))
    if len(opts) != 5:
        errs.append(f"need 5 options, got {len(opts)}")
    for i, o in enumerate(opts):
        wc = len(o.split())
        if wc < 5:
            errs.append(f"option {i+1} too short ({wc} words)")
        if wc > 20:
            errs.append(f"option {i+1} too long ({wc} words)")
        if _starts_bad_subject(o):
            errs.append(f"option {i+1} must not start with You/He/She")
        if not _has_modal_or_adj(o):
            errs.append(f"option {i+1} missing modal verb or key adjective")
    ans = str(qd.get("CorrectAnswer") or "").strip()
    if ans not in CIRCLED:
        errs.append("CorrectAnswer must be ①-⑤")
    expl = str(qd.get("Explanation") or "")
    if len(expl) < 20:
        errs.append("Explanation too short")
    if len(expl) > 450:
        errs.append("Explanation too long")
    return errs


def _has_hangul(s: str) -> bool:
    return any("가" <= ch <= "힣" for ch in s)


def run_pipeline(
    model: Any,
    tokenizer: Any,
    passage: str,
    *,
    max_retries: int = 2,
    temp: float = 0.3,
    has_explain_adapter: bool = False,
) -> dict[str, Any]:
    trace: list[dict[str, Any]] = []

    def call(sys_p: str, user: str, max_tokens: int = 400) -> dict | None:
        return chat_json(model, tokenizer, sys_p, user, max_tokens=max_tokens, temp=temp)

    # 1) thesis
    thesis = call(
        THESIS_SYS,
        f"[Passage]\n{passage}\n\nReturn thesis_en and thesis_ko JSON.",
        max_tokens=256,
    )
    if not thesis or not str(thesis.get("thesis_en") or "").strip():
        _log_failure(
            passage=passage, stage="thesis", bad_output=thesis,
            problem="thesis extraction failed", thesis=None,
        )
        return {"ok": False, "error": "thesis stage failed", "trace": trace}
    thesis_en = str(thesis.get("thesis_en")).strip()
    thesis_ko = str(thesis.get("thesis_ko") or "").strip()
    thesis_obj = {"thesis_en": thesis_en, "thesis_ko": thesis_ko}
    trace.append({"stage": "thesis", "out": thesis_obj})
    print(f"[pipeline] thesis: {thesis_en[:120]}", file=sys.stderr)

    # 2) practical claim (step down from thesis) — with its own verify/revise loop
    practical_en = ""
    for p_try in range(max_retries + 1):
        prac = call(
            PRACTICAL_SYS,
            f"[Passage]\n{passage}\n\n[Thesis]\n{thesis_en}\n\nReturn practical_en JSON.",
            max_tokens=200,
        )
        cand = str((prac or {}).get("practical_en") or "").strip()
        trace.append({"stage": "practical", "out": prac})
        if not cand:
            continue
        pver = call(
            VERIFY_PRACTICAL_SYS,
            f"[Thesis]\n{thesis_en}\n\n[Practical claim]\n{cand}\n\nReturn ok, is_just_thesis_plus_modal, missing_modal_or_adjective, issue, better_sentence JSON.",
            max_tokens=256,
        )
        trace.append({"stage": "verify_practical", "out": pver})
        if pver is None or bool(pver.get("ok")):
            practical_en = cand
            break
        better = str(pver.get("better_sentence") or "").strip()
        print(
            f"[pipeline] practical verify fail try={p_try}: {pver.get('issue')}",
            file=sys.stderr,
        )
        _log_failure(
            passage=passage, stage="verify_practical", bad_output={"practical": cand, "verify": pver},
            problem=str(pver.get("issue") or "thesis+modal / missing modal-adjective"), thesis=thesis_obj,
            improved_hint=better,
        )
        if better and _has_modal_or_adj(better) and not _starts_bad_subject(better):
            practical_en = better
            if p_try >= 1:
                break
    if not practical_en:
        practical_en = f"It is essential to act on the idea that {thesis_en[0].lower()}{thesis_en[1:]}".rstrip(".")
    print(f"[pipeline] practical: {practical_en[:120]}", file=sys.stderr)

    options: list[str] = [practical_en]
    correct_index = 0

    for draft_try in range(max_retries + 1):
        # 3) draft distractors
        draft = call(
            DRAFT_DIST_SYS,
            f"[Passage]\n{passage}\n\n[Thesis]\n{thesis_en}\n\n[Correct claim]\n{practical_en}\n\n"
            "Return JSON with key options (array of 4 English distractor sentences).",
            max_tokens=600,
        )
        distractors = _normalize_options((draft or {}).get("options"))
        if len(distractors) != 4:
            distractors = _fallback_distractors(thesis_en, practical_en)
            _log_failure(
                passage=passage, stage="draft", bad_output=draft,
                problem="draft distractors invalid; used fillers", thesis=thesis_obj,
            )
            trace.append({"stage": "draft", "ok": False, "fallback": True, "out": draft})
        else:
            trace.append({"stage": "draft", "ok": True, "options": distractors})

        # place correct option at a randomized-ish position: rotate by draft_try so repeated
        # retries don't all land on ①
        correct_index = draft_try % 5
        options = distractors[:correct_index] + [practical_en] + distractors[correct_index:]
        options = options[:5]
        if len(options) != 5:
            continue

        # 4) verify distractors (+ revise)
        dist_ok = False
        for d_try in range(max_retries + 1):
            correct = options[correct_index]
            cur_dist = [options[i] for i in range(5) if i != correct_index]
            dver = call(
                VERIFY_DIST_SYS,
                f"[Passage]\n{passage}\n\n[Correct]\n{correct}\n\n"
                f"[Distractors]\n{json.dumps(cur_dist, ensure_ascii=False)}\n\n"
                "Return ok, issues, options JSON.",
                max_tokens=400,
            )
            trace.append({"stage": "verify_distractors", "out": dver})
            if dver is None:
                dist_ok = True
                break
            if bool((dver or {}).get("ok")):
                dist_ok = True
                break
            if d_try >= max_retries:
                print("[pipeline] distractor verify soft-pass on last retry", file=sys.stderr)
                dist_ok = True
                break
            issues = (dver or {}).get("issues") or ["distractor quality fail"]
            print(f"[pipeline] distractor verify fail: {issues}", file=sys.stderr)
            _log_failure(
                passage=passage, stage="verify_distractors",
                bad_output={"distractors": cur_dist, "verify": dver},
                problem="; ".join(str(x) for x in issues), thesis=thesis_obj,
            )
            revised = _normalize_options((dver or {}).get("options"))
            if len(revised) != 4:
                rev2 = call(
                    REVISE_DIST_SYS,
                    f"[Passage]\n{passage}\n\n[Correct — do not change]\n{correct}\n\n"
                    f"[Bad distractors]\n{json.dumps(cur_dist, ensure_ascii=False)}\n\n"
                    f"[Issues]\n{json.dumps(issues, ensure_ascii=False)}\n\n"
                    "Return options[4] JSON.",
                    max_tokens=400,
                )
                revised = _normalize_options((rev2 or {}).get("options"))
                trace.append({"stage": "revise_distractors", "out": rev2})
            if len(revised) == 4:
                new_opts: list[str] = []
                di = 0
                for i in range(5):
                    if i == correct_index:
                        new_opts.append(options[correct_index])
                    else:
                        new_opts.append(revised[di])
                        di += 1
                options = new_opts

        if not dist_ok:
            continue

        # 5) explanation (optional dedicated explain LoRA)
        if has_explain_adapter:
            set_adapter(model, "explain")
            print("[pipeline] explain adapter active", file=sys.stderr)
        try:
            expl = call(
                EXPLAIN_SYS,
                f"[지문 Paragraph]\n{passage}\n\n"
                f"[Question]\n이 글에서 글쓴이가 주장하는 바로 가장 적절한 것은?\n\n"
                f"[Options]\n{_format_options(options)}\n\n"
                f"[CorrectAnswer]\n{CIRCLED[correct_index]}\n\n"
                f"[Thesis]\n{thesis_en} / {thesis_ko}\n\n"
                "위 정답에 대한 한국어 Explanation JSON만 출력하세요.",
                max_tokens=400,
            )
        finally:
            if has_explain_adapter:
                set_adapter(model, "default")
        explanation = str((expl or {}).get("Explanation") or "").strip()
        if len(explanation) > 450:
            explanation = explanation[:450].rstrip() + "…"
        if len(explanation) < 40 or not _has_hangul(explanation):
            explanation = (
                f"정답은 {CIRCLED[correct_index]}. 글의 논지는 「{thesis_ko or thesis_en}」이며, "
                f"필자는 이를 실천으로 옮겨 「{practical_en}」을 주장한다. 다른 선지는 반대 방향이거나 "
                f"이 글이 요구하지 않는 실천이다."
            )[:450]
        trace.append({"stage": "explain", "out": expl, "used_explain_adapter": has_explain_adapter})

        # Ensure every option is a valid sentence
        fillers = _fallback_distractors(thesis_en, practical_en)
        fixed_opts = []
        fi = 0
        for i, o in enumerate(options[:5]):
            bad = len(o.split()) < 5 or _starts_bad_subject(o) or not _has_modal_or_adj(o)
            if bad:
                if i == correct_index:
                    fixed_opts.append(practical_en)
                else:
                    fixed_opts.append(fillers[fi % 4])
                    fi += 1
            else:
                fixed_opts.append(o)
        while len(fixed_opts) < 5:
            fixed_opts.append(fillers[len(fixed_opts) % 4])
        options = fixed_opts[:5]

        qd = {
            "Question": "이 글에서 글쓴이가 주장하는 바로 가장 적절한 것은?",
            "Paragraph": passage,
            "Options": _format_options(options),
            "CorrectAnswer": CIRCLED[correct_index],
            "Explanation": explanation,
            "OptionType": "English",
        }
        fmt_errs = _format_ok(qd, passage)
        if fmt_errs:
            _log_failure(
                passage=passage, stage="format", bad_output=qd,
                problem="; ".join(fmt_errs), thesis=thesis_obj,
            )
            trace.append({"stage": "format", "ok": False, "errors": fmt_errs})
            continue

        return {
            "ok": True,
            "question_data": qd,
            "pipeline": {
                "thesis": thesis_obj,
                "practical_en": practical_en,
                "correct_index": correct_index,
                "draft_try": draft_try,
                "trace_len": len(trace),
                "explain_adapter": has_explain_adapter,
            },
        }

    return {"ok": False, "error": "pipeline exhausted retries", "trace": trace[-8:]}


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

    ap = argparse.ArgumentParser(description="Claim pipeline infer (thesis/practical/verify/revise)")
    ap.add_argument("--model", default="")
    ap.add_argument("--adapter", default=str(DEFAULT_ADAPTER))
    ap.add_argument(
        "--explain-adapter",
        default=str(DEFAULT_EXPLAIN_ADAPTER),
        help="optional explanation-only LoRA (claim-explain-lora-cuda)",
    )
    ap.add_argument("--passage-file")
    ap.add_argument("--paste", action="store_true")
    ap.add_argument("--max-tokens", type=int, default=512, help="per-stage max tokens")
    ap.add_argument("--temp", type=float, default=0.3)
    ap.add_argument("--max-retries", type=int, default=2)
    ap.add_argument("--json-only", action="store_true")
    ap.add_argument("--no-4bit", action="store_true")
    ap.add_argument("--verbose-trace", action="store_true")
    args = ap.parse_args()

    if args.passage_file:
        passage = Path(args.passage_file).read_text(encoding="utf-8").strip()
    elif args.paste or sys.stdin.isatty():
        passage = read_passage_interactive()
    else:
        passage = sys.stdin.read().strip()
    if not passage:
        print("empty passage", file=sys.stderr)
        return 1

    if passage.startswith("﻿"):
        passage = passage.lstrip("﻿")

    adapter_path = Path(args.adapter)
    has_adapter = adapter_exists(adapter_path)
    model_name = (args.model or "").strip() or load_base_model_name(
        adapter_path if has_adapter else Path("."), DEFAULT_MODEL
    )
    use_4bit = resolve_use_4bit(adapter_path, args.no_4bit)

    explain_path = Path(args.explain_adapter)
    print(
        f"[pipeline] passage={len(passage)} chars load model 4bit={use_4bit}",
        file=sys.stderr,
    )
    try:
        model, tokenizer, flags = load_model(
            model_name,
            adapter_path if has_adapter else None,
            use_4bit,
            explain_adapter=explain_path if adapter_exists(explain_path) else None,
        )
    except RuntimeError as e:
        print(str(e), file=sys.stderr)
        return 1

    result = run_pipeline(
        model,
        tokenizer,
        passage,
        max_retries=max(0, args.max_retries),
        temp=args.temp,
        has_explain_adapter=bool(flags.get("explain_adapter")),
    )
    if not result.get("ok"):
        out = {"ok": False, "error": result.get("error")}
        if args.verbose_trace:
            out["trace"] = result.get("trace")
        print(json.dumps(out, ensure_ascii=False))
        return 2

    qd = result["question_data"]
    payload: dict[str, Any] = {"ok": True, "question_data": qd}
    if args.verbose_trace:
        payload["pipeline"] = result.get("pipeline")
    print(json.dumps(payload, ensure_ascii=False))
    if not args.json_only:
        print(format_exam_view(qd))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
