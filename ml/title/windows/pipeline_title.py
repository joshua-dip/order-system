#!/usr/bin/env python3
"""Title multi-stage pipeline: message -> draft -> verify -> revise -> explain.

Same 0.5B/LoRA, multiple small JSON calls. stdout contract matches infer.py:
  first line { ok, question_data } + optional exam preview.
"""
from __future__ import annotations

import argparse
import json
import random
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

from _title_common import (  # noqa: E402
    CIRCLED,
    SYSTEM_PROMPT,
    extract_json_object,
    format_exam_view,
    read_passage_interactive,
)
from _cuda_runtime import (  # noqa: E402
    DEFAULT_ADAPTER,
    DEFAULT_EXPLAIN_ADAPTER,
    DEFAULT_MODEL,
    adapter_exists,
    chat_text,
    load_base_model_name,
    load_model,
    resolve_use_4bit,
    set_adapter,
)

FAILURE_DIR = _ROOT / "data" / "title-pipeline-failures"

MESSAGE_SYS = """You extract the single core message of an English passage for a Korean CSAT-style title question.
Output ONLY one JSON object. No markdown.
Keys: message_en (one English phrase or short sentence, facts from the passage only), message_ko (one Korean sentence).
Do NOT add ideas that are not in the passage. The core message is what a good newspaper headline for this passage would convey — not a flat topic label."""

DRAFT_SYS = """You write five English news-headline-style options for a Korean CSAT 「제목」 (title) question.
Output ONLY one JSON object. No markdown.
Keys: options (array of exactly 5 English headline phrases, 7-12 words each, each starting with a Capital Letter, no leading ①), correct_index (0-4).
Rules:
- correct option must capture the core message as a catchy but accurate headline (not a plain restatement).
- do not use proper nouns, character names, book titles, or the name of an analogy/example itself as the headline subject.
- distractors must be plausible headlines but wrong relative to the passage (too narrow, too broad, or about a side detail).
- no duplicate meanings among options."""

VERIFY_ANS_SYS = """You check whether a correct title option matches the core message without adding unsupported info.
Output ONLY one JSON object. No markdown.
Keys: match (bool), unsupported (bool), issue (short English string or empty), better_option (English headline phrase if revise needed else empty string).
unsupported=true if the option adds claims not in the message/passage. match=false if the option is too generic to be a real headline, or names a proper noun/example instead of the main message."""

REVISE_ANS_SYS = """You revise ONLY the correct title option so it matches the core message without unsupported additions.
Output ONLY one JSON object. No markdown.
Keys: correct_option (one English headline phrase, 7-12 words, starting with a Capital Letter)."""

VERIFY_DIST_SYS = """You check four distractor options for a title MCQ.
Output ONLY one JSON object. No markdown.
Keys: ok (bool), issues (array of short English strings), options (array of exactly 4 revised distractors if ok=false else empty array).
Fail if: duplicate meanings, same meaning as correct, unrelated to the passage, or clearly true given the message."""

REVISE_DIST_SYS = """You rewrite four distractors for a title MCQ. Keep the correct option unchanged.
Output ONLY one JSON object. No markdown.
Keys: options (array of exactly 4 English headline phrases, 7-12 words, each starting with a Capital Letter).
Distractors must be wrong relative to the core message, distinct, and passage-related."""

EXPLAIN_SYS = """당신은 한국 수능 영어 「제목」 문항의 한국어 해설만 작성합니다.
반드시 아래 키만 갖는 JSON 한 개만 출력하세요. 마크다운·설명 금지.

키: Explanation

규칙:
1) Explanation = 한국어만, 450자 이하.
2) 정답(CorrectAnswer)이 왜 제목으로 가장 적절한지 한 결론으로 밝힌다.
3) 오답 1~2개를 짧게 왜 아닌지 말할 수 있다(범위가 좁거나 넓다, 부분 소재에 그친다 등).
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


def _titlecase_start(s: str) -> str:
    s = s.strip()
    if not s:
        return s
    return s[0].upper() + s[1:]


def _format_options(phrases: list[str]) -> str:
    parts = []
    for i, p in enumerate(phrases[:5]):
        parts.append(f"{CIRCLED[i]} {_strip_circled(p)}")
    return " ### ".join(parts)


def _shuffle_answer(options: list[str], correct_index: int) -> tuple[list[str], int]:
    """정답 위치를 ①~⑤ 중 무작위로 — 해설을 쓰기 전에 섞어 해설이 최종 번호를 그대로 쓰게 한다."""
    order = list(range(len(options)))
    random.shuffle(order)
    return [options[i] for i in order], order.index(correct_index)


def _log_failure(
    *,
    passage: str,
    stage: str,
    bad_output: Any,
    problem: str,
    message: dict | None,
    improved_hint: str = "",
) -> None:
    FAILURE_DIR.mkdir(parents=True, exist_ok=True)
    row = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "passage": passage[:4000],
        "stage": stage,
        "bad_output": bad_output,
        "problem": problem,
        "message": message,
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
        if wc < 4:
            errs.append(f"option {i+1} too short ({wc} words)")
        if wc > 18:
            errs.append(f"option {i+1} too long ({wc} words)")
        if o[:1] and not o[:1].isupper():
            errs.append(f"option {i+1} must start with a capital letter")
    ans = str(qd.get("CorrectAnswer") or "").strip()
    if ans not in CIRCLED:
        errs.append("CorrectAnswer must be ①-⑤")
    q = str(qd.get("Question") or "")
    if "제목" not in q:
        errs.append("Question should mention 제목")
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
    main_adapter: str | None = None,
    explain_adapter: str = "explain",
) -> dict[str, Any]:
    """main_adapter/explain_adapter: 어댑터 여러 개를 붙여 둔 모델(워커)에서 쓸 이름.
    단독 실행(main_adapter=None)은 주 어댑터 "default", 해설 "explain" 그대로."""
    trace: list[dict[str, Any]] = []
    if main_adapter:
        set_adapter(model, main_adapter)

    raw_out = [""]  # 마지막 모델 출력 원문 — JSON 이 깨졌을 때 실패 기록에 남긴다

    def call(sys_p: str, user: str, max_tokens: int = 400) -> dict | None:
        raw_out[0] = chat_text(model, tokenizer, sys_p, user, max_tokens=max_tokens, temp=temp)
        return extract_json_object(raw_out[0])

    # 1) core message — 작은 모델이라 JSON 이 가끔 깨진다. 몇 번 다시 묻고, 비었거나 한국어면 버린다
    message_en = message_ko = ""
    for _ in range(max_retries + 1):
        msg = call(
            MESSAGE_SYS,
            f"[Passage]\n{passage}\n\nReturn message_en and message_ko JSON.",
            max_tokens=256,
        )
        cand = str((msg or {}).get("message_en") or "").strip()
        if cand and not _has_hangul(cand):
            message_en, message_ko = cand, str(msg.get("message_ko") or "").strip()
            break
        _log_failure(
            passage=passage,
            stage="message",
            bad_output=msg if msg is not None else {"raw": raw_out[0][:800]},
            problem="core message extraction failed",
            message=None,
        )
    if not message_en:
        return {"ok": False, "error": "message stage failed", "trace": trace}
    message_obj = {"message_en": message_en, "message_ko": message_ko}
    trace.append({"stage": "message", "out": message_obj})
    print(f"[pipeline] message: {message_en[:120]}", file=sys.stderr)

    options: list[str] = []
    correct_index = 0

    for draft_try in range(max_retries + 1):
        # 2) draft
        draft = call(
            DRAFT_SYS,
            f"[Passage]\n{passage}\n\n[Core message]\n{message_en}\n\n"
            "Return JSON with keys options (array of 5 English headline phrases) "
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
            # 선지를 못 받으면 지어내지 않고 다시 시도한다(예전엔 특정 예문용 고정 헤드라인으로 채웠다)
            _log_failure(
                passage=passage,
                stage="draft",
                bad_output=draft if draft is not None else {"raw": raw_out[0][:800]},
                problem="draft options invalid",
                message=message_obj,
            )
            trace.append({"stage": "draft", "ok": False, "out": draft})
            continue
        options, correct_index = parsed_draft
        trace.append(
            {
                "stage": "draft",
                "ok": True,
                "correct_index": correct_index,
                "options": options,
            }
        )
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
                f"[Passage]\n{passage}\n\n[Core message]\n{message_en}\n\n"
                f"[Correct option]\n{correct}\n\n"
                "Return match, unsupported, issue, better_option JSON.",
                max_tokens=256,
            )
            match = bool((ver or {}).get("match"))
            unsupported = bool((ver or {}).get("unsupported"))
            better = str((ver or {}).get("better_option") or "").strip()
            issue = str((ver or {}).get("issue") or "").strip()
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
                if len(bo.split()) >= 4:
                    options[correct_index] = _titlecase_start(bo)
                    if v_try >= 1:
                        ans_ok = True
                        break
            print(f"[pipeline] answer verify fail: {issue or 'mismatch'}", file=sys.stderr)
            _log_failure(
                passage=passage,
                stage="verify_answer",
                bad_output={"option": correct, "verify": ver},
                problem=issue or "answer does not match core message",
                message=message_obj,
                improved_hint=better,
            )
            if v_try >= max_retries:
                options[correct_index] = _titlecase_start(message_en)
                print("[pipeline] answer verify soft-pass on last retry", file=sys.stderr)
                ans_ok = True
                break
            rev = call(
                REVISE_ANS_SYS,
                f"[Passage]\n{passage}\n\n[Core message]\n{message_en}\n\n"
                f"[Bad correct option]\n{correct}\n\n"
                f"[Issue]\n{issue}\n\n"
                f"[Hint]\n{better}\n\n"
                "Return corrected correct_option JSON.",
                max_tokens=128,
            )
            new_opt = _strip_circled(str((rev or {}).get("correct_option") or ""))
            trace.append({"stage": "revise_answer", "out": rev})
            if new_opt:
                options[correct_index] = _titlecase_start(new_opt)

        if not ans_ok:
            continue

        # 4) verify distractors (+ revise)
        dist_ok = False
        for d_try in range(max_retries + 1):
            correct = options[correct_index]
            distractors = [options[i] for i in range(5) if i != correct_index]
            dver = call(
                VERIFY_DIST_SYS,
                f"[Passage]\n{passage}\n\n[Core message]\n{message_en}\n\n"
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
                message=message_obj,
            )
            if d_try >= max_retries:
                break
            revised = [_titlecase_start(x) for x in _normalize_options((dver or {}).get("options"))]
            if len(revised) != 4:
                rev2 = call(
                    REVISE_DIST_SYS,
                    f"[Passage]\n{passage}\n\n[Core message]\n{message_en}\n\n"
                    f"[Correct — do not change]\n{correct}\n\n"
                    f"[Bad distractors]\n{json.dumps(distractors, ensure_ascii=False)}\n\n"
                    f"[Issues]\n{json.dumps(issues, ensure_ascii=False)}\n\n"
                    "Return options[4] JSON.",
                    max_tokens=400,
                )
                revised = [_titlecase_start(x) for x in _normalize_options((rev2 or {}).get("options"))]
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

        options, correct_index = _shuffle_answer(options, correct_index)

        # 5) explanation (optional dedicated explain LoRA)
        if has_explain_adapter:
            set_adapter(model, explain_adapter)
            print("[pipeline] explain adapter active", file=sys.stderr)
        try:
            expl = call(
                EXPLAIN_SYS,
                f"[지문 Paragraph]\n{passage}\n\n"
                f"[Question]\n이 글의 제목으로 가장 적절한 것은?\n\n"
                f"[Options]\n{_format_options(options)}\n\n"
                f"[CorrectAnswer]\n{CIRCLED[correct_index]}\n\n"
                f"[Core message]\n{message_en} / {message_ko}\n\n"
                "위 정답에 대한 한국어 Explanation JSON만 출력하세요.",
                max_tokens=400,
            )
        finally:
            if has_explain_adapter:
                set_adapter(model, main_adapter or "default")
        explanation = str((expl or {}).get("Explanation") or "").strip()
        if len(explanation) > 450:
            explanation = explanation[:450].rstrip() + "…"
        if len(explanation) < 40 or not _has_hangul(explanation):
            explanation = (
                f"정답은 {CIRCLED[correct_index]}. 글의 핵심 메시지는 「{message_ko or message_en}」이므로 "
                f"이를 헤드라인으로 담은 선지가 제목이다. 다른 선지는 부분 소재이거나 범위가 어긋난다."
            )[:450]
        trace.append({"stage": "explain", "out": expl, "used_explain_adapter": has_explain_adapter})

        # 대문자로 시작하게 맞추고, 정답 선지가 너무 짧게 망가졌으면 핵심 메시지로 바꾼다.
        # 오답은 지어내지 않는다 — 짧은 오답은 아래 형식 검사에서 걸러 다시 시도한다
        options = [
            _titlecase_start(message_en if i == correct_index and len(o.split()) < 4 else o)
            for i, o in enumerate(options[:5])
        ]

        qd = {
            "Question": "이 글의 제목으로 가장 적절한 것은?",
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
                message=message_obj,
            )
            trace.append({"stage": "format", "ok": False, "errors": fmt_errs})
            continue

        return {
            "ok": True,
            "question_data": qd,
            "pipeline": {
                "message": message_obj,
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

    ap = argparse.ArgumentParser(description="Title pipeline infer (message/verify/revise)")
    ap.add_argument("--model", default="")
    ap.add_argument("--adapter", default=str(DEFAULT_ADAPTER))
    ap.add_argument(
        "--explain-adapter",
        default=str(DEFAULT_EXPLAIN_ADAPTER),
        help="optional explanation-only LoRA (title-explain-lora-cuda)",
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
