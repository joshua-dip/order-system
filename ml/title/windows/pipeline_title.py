#!/usr/bin/env python3
"""Title multi-stage pipeline: message -> draft -> verify -> revise -> explain.

Same 0.5B/LoRA, multiple small JSON calls. stdout contract matches infer.py:
  first line { ok, question_data } + optional exam preview.
"""
from __future__ import annotations

import argparse
import json
import random
import re
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

from json_extract import explanation_text, trim_to_sentence  # noqa: E402

from distractor_check import distinct_options, fix_distractors, flagged_warnings, solve_check  # noqa: E402

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

EXPLAIN_SYS = """당신은 한국 수능 영어 「제목」 문항의 한국어 해설만 작성합니다.
반드시 아래 키만 갖는 JSON 한 개만 출력하세요. 마크다운·설명 금지.

키: Explanation

규칙:
1) Explanation = 한국어만, 450자 이하.
2) 정답(CorrectAnswer)이 왜 제목으로 가장 적절한지 한 결론으로 밝힌다.
3) 오답 1~2개를 짧게 왜 아닌지 말할 수 있다(범위가 좁거나 넓다, 부분 소재에 그친다 등).
4) 지문에 없는 내용을 지어내지 않는다.
5) 영어 문장으로만 된 해설 금지."""


def _pick_str(obj: dict | None, *keys: str) -> str:
    """0.5B 모델이 키 이름을 조금씩 바꿔 내는 일이 잦다 — 후보 키 중 처음 채워진 문자열."""
    if not isinstance(obj, dict):
        return ""
    for k in keys:
        v = obj.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return ""


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


def _parse_lora_qd(obj: dict | None) -> tuple[list[str], int] | None:
    """LoRA 가 학습한 문항 JSON(Options ### 5개 + CorrectAnswer ①~⑤)에서 선지·정답 위치."""
    if not isinstance(obj, dict):
        return None
    opts = _normalize_options(obj.get("Options") or obj.get("options"))
    ans = str(obj.get("CorrectAnswer") or "").strip()
    if len(opts) == 5 and ans in CIRCLED:
        return opts, CIRCLED.index(ans)
    return None


def _dup_option_errors(opts: list[str]) -> list[str]:
    """같은 선지가 두 번 나오면 복수정답이 된다(검증 단계가 정답을 오답 자리에 베껴 넣은 적이 있다)."""
    errs: list[str] = []
    seen: set[str] = set()
    for i, o in enumerate(opts):
        key = re.sub(r"[^a-z0-9]+", " ", o.lower()).strip()
        if key in seen:
            errs.append(f"option {i+1} duplicates another option")
        seen.add(key)
    return errs


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
    errs += _dup_option_errors(opts)
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


def _min_distractor_words(correct: str) -> int:
    """오답 최소 단어 수 — 6단어, 정답이 그보다 짧으면 정답 길이.
    초안 오답이 5단어짜리로 나와(「Print Media Versus Broadcast Media」) 8단어 정답과 오답 한 개만 길어
    「긴 것 둘 중 하나」로 좁혀졌다(26년 9월 고1 41~42번)."""
    return min(6, len(correct.split()))


def _short_distractor(distractor: str, correct: str) -> str | None:
    wc, need = len(distractor.split()), _min_distractor_words(correct)
    if wc < need:
        return f"too short ({wc} words; the answer has {len(correct.split())}) — write {max(need, 7)}-12 words so length gives no clue"
    return None


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

    # 제목 LoRA 는 (SYSTEM_PROMPT, 지문) → 문항 JSON 만 학습했다. 다른 단계에 켜 두면 시스템 프롬프트를
    # 무시하고 문항 JSON 을 뱉어 단계가 실패한다. 기본은 어댑터를 끈 베이스, 초안·해설 어댑터만 adapter=True.
    raw_out = [""]  # 마지막 모델 출력 원문 — JSON 이 깨졌을 때 실패 기록에 남긴다

    def call(
        sys_p: str,
        user: str,
        max_tokens: int = 400,
        *,
        adapter: bool = False,
        t: float | None = None,
    ) -> dict | None:
        raw_out[0] = chat_text(
            model,
            tokenizer,
            sys_p,
            user,
            max_tokens=max_tokens,
            temp=temp if t is None else t,
            use_adapter=adapter,
        )
        return extract_json_object(raw_out[0])

    def lora_draft() -> tuple[dict | None, tuple[list[str], int] | None]:
        """학습한 그대로의 입력(SYSTEM_PROMPT + 지문)으로 LoRA 문항 초안을 받는다."""
        full = call(SYSTEM_PROMPT, f"[지문 Paragraph]\n{passage}", max_tokens=1200, adapter=True)
        return full, _parse_lora_qd(full)

    # 1) core message — 베이스 모델. 두 번째는 탐욕 디코딩, 비슷한 키도 받는다.
    # 베이스 0.5B 는 message_en 에 한국어를 넣기도 한다 — 영어가 아니면 버리고 다시 묻는다.
    msg: dict | None = None
    message_raw = ""
    for m_try in range(2):
        msg = call(
            MESSAGE_SYS,
            f"[Passage]\n{passage}\n\nReturn message_en and message_ko JSON.",
            max_tokens=256,
            t=temp if m_try == 0 else 0.0,
        )
        message_raw = _pick_str(msg, "message_en", "message", "main_idea", "core_message", "claim_en")
        if message_raw and not _has_hangul(message_raw):
            break
        _log_failure(
            passage=passage,
            stage="message",
            bad_output=msg if msg is not None else {"raw": raw_out[0][:800]},
            problem="core message extraction failed" if not message_raw else "message_en is not English",
            message=None,
        )
        message_raw = ""
    lora_first: tuple[dict | None, tuple[list[str], int] | None] | None = None
    if not message_raw:
        # 마지막 수단: LoRA 초안의 정답 제목을 핵심 메시지로(초안 단계에서 그대로 재사용).
        lora_first = lora_draft()
        if lora_first[1] is not None:
            opts, idx = lora_first[1]
            if not _has_hangul(opts[idx]):
                message_raw = opts[idx]
                trace.append({"stage": "message", "fallback": "lora_draft_answer"})
    if not message_raw:
        return {"ok": False, "error": "message stage failed", "trace": trace}
    message_en = message_raw
    message_ko = _pick_str(msg, "message_ko", "message_korean", "ko")
    message_obj = {"message_en": message_en, "message_ko": message_ko}
    trace.append({"stage": "message", "out": message_obj})
    print(f"[pipeline] message: {message_en[:120]}", file=sys.stderr)

    options: list[str] = []
    correct_index = 0

    for draft_try in range(max_retries + 1):
        # 2) draft — LoRA 가 학습한 형식(SYSTEM_PROMPT → 문항 JSON)을 먼저, 안 되면 베이스 + 작은 스키마
        if draft_try == 0 and lora_first is not None:
            draft, parsed_draft = lora_first
        else:
            draft, parsed_draft = lora_draft()
        if parsed_draft is None:
            draft = call(
                DRAFT_SYS,
                f"[Passage]\n{passage}\n\n[Core message]\n{message_en}\n\n"
                "Return JSON with keys options (array of 5 English headline phrases) "
                "and correct_index (0-4). Do not wrap in markdown.",
                max_tokens=700,
            )
            parsed_draft = _parse_draft(draft)
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

        # 4) 오답 검증 — 선지마다 판정해 정답으로도 읽히거나 겹치는 것만 새로 쓴다(ml/common/distractor_check.py).
        #    끝까지 못 고친 오답은 경고로 남긴다 — 예전엔 세 번째 판정에서 그냥 통과시켰다.
        options, flagged = fix_distractors(
            call,
            kind="title",
            passage=passage,
            core=message_en,
            options=options,
            correct_index=correct_index,
            max_retries=max_retries,
            accept=lambda c, cands: distinct_options(
                c, cands, valid=lambda o: _min_distractor_words(c) <= len(o.split()) <= 18 and o[:1].isupper()),
            normalize=_normalize_options,
            trace=trace,
            log_failure=lambda **kw: _log_failure(passage=passage, message=message_obj, **kw),
            form_issue=_short_distractor,
        )


        options, correct_index = _shuffle_answer(options, correct_index)
        # 5) 끝까지 못 고친 오답 + 모의 풀이(정답 모르는 학생처럼 풀기) → 관리자 화면 「검증 경고」
        warnings = flagged_warnings(flagged, options) + solve_check(
            call, kind="title", passage=passage, options_text=_format_options(options),
            answer=CIRCLED[correct_index], trace=trace,
        )

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
                adapter=has_explain_adapter,
            )
        finally:
            if has_explain_adapter:
                set_adapter(model, main_adapter or "default")
        # 35B 추론 모델은 해설을 JSON 없이 글로만 쓰기도 한다 — 원문도 받는다(정답 번호가 어긋나면 버림)
        explanation = explanation_text(expl, raw_out[0], CIRCLED[correct_index])
        explanation = trim_to_sentence(explanation, 450)
        if len(explanation) < 40 or not _has_hangul(explanation):
            explanation = (
                f"정답은 {CIRCLED[correct_index]}. 글의 핵심 메시지는 「{message_ko or message_en}」이므로 "
                f"이를 헤드라인으로 담은 선지가 제목이다. 다른 선지는 부분 소재이거나 범위가 어긋난다."
            )[:450]
        trace.append({"stage": "explain", "out": expl, "used_explain_adapter": has_explain_adapter})

        # 대문자로 시작하게 맞추고, 정답 선지가 너무 짧게 망가졌으면 핵심 메시지로 바꾼다.
        # 오답은 지어내지 않는다 — 짧거나 겹치는 오답은 아래 형식 검사에서 걸러 다시 시도한다
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
            "warnings": warnings,
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
