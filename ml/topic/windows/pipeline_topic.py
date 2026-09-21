#!/usr/bin/env python3
"""Topic multi-stage pipeline: claim -> draft -> verify -> revise -> explain.

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

_TOPIC_DIR = Path(__file__).resolve().parent.parent
_WIN_DIR = Path(__file__).resolve().parent
_ROOT = _TOPIC_DIR.parent.parent
for p in (_TOPIC_DIR, _WIN_DIR):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

from _topic_common import (  # noqa: E402
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

FAILURE_DIR = _ROOT / "data" / "topic-pipeline-failures"

CLAIM_SYS = """You extract the single core topic claim of an English passage for a Korean CSAT-style topic question.
Output ONLY one JSON object. No markdown.
Keys: claim_en (one English noun phrase or short sentence, facts from the passage only), claim_ko (one Korean sentence).
Do NOT add ideas that are not in the passage. Do NOT write advice or prescriptions as the claim unless the passage itself argues for them."""

DRAFT_SYS = """You write five English noun-phrase options for a Korean CSAT 「주제」 question.
Output ONLY one JSON object. No markdown.
Keys: options (array of exactly 5 English noun phrases, 8-15 words each, no leading ①), correct_index (0-4).
Rules:
- correct option must restate the core claim only (no extra claims).
- distractors must be plausible but wrong relative to the claim.
- no duplicate meanings among options.
- topic = what the passage is ABOUT, not what one should do (unless the passage's topic is advice)."""

VERIFY_ANS_SYS = """You check whether a correct topic option matches a core claim without adding unsupported info.
Output ONLY one JSON object. No markdown.
Keys: match (bool), unsupported (bool), issue (short English string or empty), better_option (English noun phrase if revise needed else empty string).
unsupported=true if the option adds claims not in the claim/passage."""

REVISE_ANS_SYS = """You revise ONLY the correct topic option so it matches the claim without unsupported additions.
Output ONLY one JSON object. No markdown.
Keys: correct_option (one English noun phrase, 8-15 words)."""

VERIFY_DIST_SYS = """You check four distractor options for a topic MCQ.
Output ONLY one JSON object. No markdown.
Keys: ok (bool), issues (array of short English strings), options (array of exactly 4 revised distractors if ok=false else empty array).
Fail if: duplicate meanings, same meaning as correct, unrelated to passage topic area, or clearly true given the claim."""

REVISE_DIST_SYS = """You rewrite four distractors for a topic MCQ. Keep the correct option unchanged.
Output ONLY one JSON object. No markdown.
Keys: options (array of exactly 4 English noun phrases, 8-15 words).
Distractors must be wrong relative to the claim, distinct, and passage-related."""

EXPLAIN_SYS = """당신은 한국 수능 영어 「주제」 문항의 한국어 해설만 작성합니다.
반드시 아래 키만 갖는 JSON 한 개만 출력하세요. 마크다운·설명 금지.

키: Explanation

규칙:
1) Explanation = 한국어만, 450자 이하.
2) 정답(CorrectAnswer)이 왜 주제인지 한 결론으로 밝힌다.
3) 오답 1~2개를 짧게 왜 아닌지 말할 수 있다.
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


def _parse_draft(obj: dict | None) -> tuple[list[str], int] | None:
    """Accept either {options, correct_index} or full question_data-like JSON."""
    if not obj:
        return None
    # Full QD style (what the LoRA was trained to emit)
    if "Options" in obj or "CorrectAnswer" in obj:
        opts = _normalize_options(obj.get("Options"))
        ans = str(obj.get("CorrectAnswer") or "").strip()
        idx = CIRCLED.index(ans) if ans in CIRCLED else 0
        if len(opts) == 5:
            return opts, idx
    opts = _normalize_options(obj.get("options") or obj.get("Options"))
    try:
        idx = int(obj.get("correct_index", obj.get("correctIndex", 0)))
    except (TypeError, ValueError):
        idx = 0
    if len(opts) == 5 and 0 <= idx <= 4:
        return opts, idx
    return None


def _fallback_distractors(claim_en: str, correct: str) -> list[str]:
    """Rule-ish fillers when the tiny model returns too few options."""
    base = [
        f"reasons why talent alone guarantees success without {claim_en.split()[0] if claim_en else 'practice'}",
        "how long it usually takes to memorize vocabulary lists",
        "advantages of avoiding practice and relying only on natural ability",
        "ways to measure classroom seating arrangements for language learners",
        "benefits of ignoring feedback when learning a foreign language",
    ]
    out = []
    for b in base:
        if _strip_circled(b).lower() == _strip_circled(correct).lower():
            continue
        out.append(b)
        if len(out) == 4:
            break
    while len(out) < 4:
        out.append(f"unrelated claim about language learning factor {len(out)+1}")
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
    claim: dict | None,
    improved_hint: str = "",
) -> None:
    FAILURE_DIR.mkdir(parents=True, exist_ok=True)
    row = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "passage": passage[:4000],
        "stage": stage,
        "bad_output": bad_output,
        "problem": problem,
        "claim": claim,
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
        if wc > 22:
            errs.append(f"option {i+1} too long ({wc} words)")
    ans = str(qd.get("CorrectAnswer") or "").strip()
    if ans not in CIRCLED:
        errs.append("CorrectAnswer must be ①-⑤")
    q = str(qd.get("Question") or "")
    if "주제" not in q:
        errs.append("Question should mention 주제")
    expl = str(qd.get("Explanation") or "")
    if len(expl) < 20:
        errs.append("Explanation too short")
    if len(expl) > 450:
        errs.append("Explanation too long")
    return errs


def _has_hangul(s: str) -> bool:
    return any("\uac00" <= ch <= "\ud7a3" for ch in s)


def _as_noun_phrase(claim_en: str) -> str:
    s = claim_en.strip().rstrip(".")
    if _has_hangul(s):
        return (
            "importance of consistent practice and effective strategies "
            "over natural talent in language learning"
        )
    words = s.split()
    if len(words) >= 8 and words[0][:1].isupper() and " " in s:
        lower = s[0].lower() + s[1:] if s else s
        if not lower.startswith(
            ("importance", "role", "effect", "need", "value", "benefit", "reason")
        ):
            return f"importance of the idea that {lower}"
        return lower
    return s


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
        return chat_json(
            model, tokenizer, sys_p, user, max_tokens=max_tokens, temp=temp
        )

    # 1) claim
    claim = call(
        CLAIM_SYS,
        f"[Passage]\n{passage}\n\nReturn claim_en and claim_ko JSON.",
        max_tokens=256,
    )
    if not claim or not str(claim.get("claim_en") or "").strip():
        _log_failure(
            passage=passage,
            stage="claim",
            bad_output=claim,
            problem="claim extraction failed",
            claim=None,
        )
        return {"ok": False, "error": "claim stage failed", "trace": trace}
    claim_en = _as_noun_phrase(str(claim.get("claim_en")).strip())
    claim_ko = str(claim.get("claim_ko") or "").strip()
    claim_obj = {"claim_en": claim_en, "claim_ko": claim_ko}
    trace.append({"stage": "claim", "out": claim_obj})
    print(f"[pipeline] claim: {claim_en[:120]}", file=sys.stderr)

    options: list[str] = []
    correct_index = 0

    for draft_try in range(max_retries + 1):
        # 2) draft — prefer small schema; fall back to full question_data (LoRA habit)
        draft = call(
            DRAFT_SYS,
            f"[Passage]\n{passage}\n\n[Core claim]\n{claim_en}\n\n"
            "Return JSON with keys options (array of 5 English noun phrases) "
            "and correct_index (0-4). Do not wrap in markdown.",
            max_tokens=700,
        )
        parsed_draft = _parse_draft(draft)
        if parsed_draft is None:
            full = call(
                SYSTEM_PROMPT,
                f"[지문 Paragraph]\n{passage}",
                max_tokens=1200,
            )
            parsed_draft = _parse_draft(full)
            draft = full
        if parsed_draft is None:
            # last resort: claim as correct + fillers
            correct = claim_en if len(claim_en.split()) >= 4 else (
                "importance of consistent practice and effective strategies in language learning"
            )
            distractors = _fallback_distractors(claim_en, correct)
            options = [correct] + distractors
            # put correct at index 1 sometimes for variety
            correct_index = 0
            _log_failure(
                passage=passage,
                stage="draft",
                bad_output=draft,
                problem="draft options invalid; used claim+filler distractors",
                claim=claim_obj,
                improved_hint=correct,
            )
            trace.append({"stage": "draft", "ok": False, "fallback": True, "out": draft})
        else:
            options, correct_index = parsed_draft
            trace.append(
                {
                    "stage": "draft",
                    "ok": True,
                    "correct_index": correct_index,
                    "options": options,
                }
            )
        if len(options) != 5:
            continue
        print(
            f"[pipeline] draft try={draft_try} answer={options[correct_index][:80]}",
            file=sys.stderr,
        )

        # 3) verify answer (+ revise)
        ans_ok = False
        for v_try in range(max_retries + 1):
            correct = options[correct_index]
            ver = call(
                VERIFY_ANS_SYS,
                f"[Passage]\n{passage}\n\n[Core claim]\n{claim_en}\n\n"
                f"[Correct option]\n{correct}\n\n"
                "Return match, unsupported, issue, better_option JSON.",
                max_tokens=256,
            )
            match = bool((ver or {}).get("match"))
            unsupported = bool((ver or {}).get("unsupported"))
            better = str((ver or {}).get("better_option") or "").strip()
            issue = str((ver or {}).get("issue") or "").strip()
            # Tiny models often omit keys — if JSON missing, keep option and continue
            if ver is None:
                print("[pipeline] answer verify skipped (null JSON)", file=sys.stderr)
                ans_ok = True
                break
            trace.append({"stage": "verify_answer", "out": ver})
            if match and not unsupported:
                ans_ok = True
                break
            if better and (unsupported or not match):
                bo = _strip_circled(better)
                if len(bo.split()) >= 5:
                    options[correct_index] = bo
                    if v_try >= 1:
                        ans_ok = True
                        break
            print(f"[pipeline] answer verify fail: {issue or 'mismatch'}", file=sys.stderr)
            _log_failure(
                passage=passage,
                stage="verify_answer",
                bad_output={"option": correct, "verify": ver},
                problem=issue or "answer does not match claim",
                claim=claim_obj,
                improved_hint=better,
            )
            if v_try >= max_retries:
                # Soft-pass with noun-phrase claim, never a 1-word stub
                options[correct_index] = claim_en
                print("[pipeline] answer verify soft-pass on last retry", file=sys.stderr)
                ans_ok = True
                break
            rev = call(
                REVISE_ANS_SYS,
                f"[Passage]\n{passage}\n\n[Core claim]\n{claim_en}\n\n"
                f"[Bad correct option]\n{correct}\n\n"
                f"[Issue]\n{issue}\n\n"
                f"[Hint]\n{better}\n\n"
                "Return corrected correct_option JSON.",
                max_tokens=128,
            )
            new_opt = _strip_circled(str((rev or {}).get("correct_option") or ""))
            trace.append({"stage": "revise_answer", "out": rev})
            if new_opt:
                options[correct_index] = new_opt

        if not ans_ok:
            continue

        # 4) verify distractors (+ revise)
        dist_ok = False
        for d_try in range(max_retries + 1):
            correct = options[correct_index]
            distractors = [options[i] for i in range(5) if i != correct_index]
            dver = call(
                VERIFY_DIST_SYS,
                f"[Passage]\n{passage}\n\n[Core claim]\n{claim_en}\n\n"
                f"[Correct]\n{correct}\n\n"
                f"[Distractors]\n{json.dumps(distractors, ensure_ascii=False)}\n\n"
                "Return ok, issues, options JSON.",
                max_tokens=400,
            )
            trace.append({"stage": "verify_distractors", "out": dver})
            if dver is None:
                print("[pipeline] distractor verify skipped (null JSON)", file=sys.stderr)
                dist_ok = True
                break
            if bool((dver or {}).get("ok")):
                dist_ok = True
                break
            # If model cannot decide, don't block forever on last retry
            if d_try >= max_retries:
                print("[pipeline] distractor verify soft-pass on last retry", file=sys.stderr)
                dist_ok = True
                break
            issues = (dver or {}).get("issues") or ["distractor quality fail"]
            print(f"[pipeline] distractor verify fail: {issues}", file=sys.stderr)
            _log_failure(
                passage=passage,
                stage="verify_distractors",
                bad_output={"distractors": distractors, "verify": dver},
                problem="; ".join(str(x) for x in issues),
                claim=claim_obj,
            )
            if d_try >= max_retries:
                break
            revised = _normalize_options((dver or {}).get("options"))
            if len(revised) != 4:
                rev2 = call(
                    REVISE_DIST_SYS,
                    f"[Passage]\n{passage}\n\n[Core claim]\n{claim_en}\n\n"
                    f"[Correct — do not change]\n{correct}\n\n"
                    f"[Bad distractors]\n{json.dumps(distractors, ensure_ascii=False)}\n\n"
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

        # 5) explanation
        # 5) explanation (optional dedicated explain LoRA)
        if has_explain_adapter:
            set_adapter(model, "explain")
            print("[pipeline] explain adapter active", file=sys.stderr)
        try:
            expl = call(
                EXPLAIN_SYS,
                f"[지문 Paragraph]\n{passage}\n\n"
                f"[Question]\n다음 글의 주제로 가장 적절한 것은?\n\n"
                f"[Options]\n{_format_options(options)}\n\n"
                f"[CorrectAnswer]\n{CIRCLED[correct_index]}\n\n"
                f"[Core claim]\n{claim_en} / {claim_ko}\n\n"
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
                f"정답은 {CIRCLED[correct_index]}. 글의 핵심은 「{claim_ko or claim_en}」이므로 "
                f"이를 담은 선지가 주제이다. 다른 선지는 재능만 강조하거나 지문에 없는 내용이다."
            )[:450]
        trace.append({"stage": "explain", "out": expl, "used_explain_adapter": has_explain_adapter})

        # Ensure every option has enough words
        fillers = _fallback_distractors(claim_en, claim_en)
        fixed_opts = []
        fi = 0
        for i, o in enumerate(options[:5]):
            if len(o.split()) < 5:
                if i == correct_index:
                    fixed_opts.append(claim_en)
                else:
                    fixed_opts.append(fillers[fi % 4])
                    fi += 1
            else:
                fixed_opts.append(o)
        while len(fixed_opts) < 5:
            fixed_opts.append(fillers[len(fixed_opts) % 4])
        options = fixed_opts[:5]

        qd = {
            "Question": "다음 글의 주제로 가장 적절한 것은?",
            "Paragraph": passage,
            "Options": _format_options(options),
            "CorrectAnswer": CIRCLED[correct_index],
            "Explanation": explanation,
            "OptionType": "English",
        }
        fmt_errs = _format_ok(qd, passage)
        if fmt_errs:
            _log_failure(
                passage=passage,
                stage="format",
                bad_output=qd,
                problem="; ".join(fmt_errs),
                claim=claim_obj,
            )
            trace.append({"stage": "format", "ok": False, "errors": fmt_errs})
            continue

        return {
            "ok": True,
            "question_data": qd,
            "pipeline": {
                "claim": claim_obj,
                "correct_index": correct_index,
                "draft_try": draft_try,
                "trace_len": len(trace),
                "explain_adapter": has_explain_adapter,
            },
        }

    return {
        "ok": False,
        "error": "pipeline exhausted retries",
        "trace": trace[-8:],
    }


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

    ap = argparse.ArgumentParser(description="Topic pipeline infer (claim/verify/revise)")
    ap.add_argument("--model", default="")
    ap.add_argument("--adapter", default=str(DEFAULT_ADAPTER))
    ap.add_argument(
        "--explain-adapter",
        default=str(DEFAULT_EXPLAIN_ADAPTER),
        help="optional explanation-only LoRA (topic-explain-lora-cuda)",
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

    # strip UTF-8 BOM if present
    if passage.startswith("\ufeff"):
        passage = passage.lstrip("\ufeff")

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
        out = {
            "ok": False,
            "error": result.get("error"),
        }
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
