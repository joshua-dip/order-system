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

from _claim_common import (  # noqa: E402
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


def _has_modal_or_adj(s: str) -> bool:
    low = s.lower()
    return any(m in low for m in MODAL_WORDS) or any(a in low for a in KEY_ADJS)


def _starts_bad_subject(s: str) -> bool:
    first = s.strip().split()[0].lower().rstrip(".,") if s.strip() else ""
    return first in ("you", "your", "he", "his", "she", "her")


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
    errs += _dup_option_errors(opts)
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
    main_adapter: str | None = None,
    explain_adapter: str = "explain",
) -> dict[str, Any]:
    """main_adapter/explain_adapter: 어댑터 여러 개를 붙여 둔 모델(워커)에서 쓸 이름.
    단독 실행(main_adapter=None)은 주 어댑터 "default", 해설 "explain" 그대로."""
    trace: list[dict[str, Any]] = []
    if main_adapter:
        set_adapter(model, main_adapter)

    # 주장 LoRA 는 (SYSTEM_PROMPT, 지문) → 문항 JSON 만 학습했다. 다른 단계에 켜 두면 시스템 프롬프트를
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

    # 1) thesis — 베이스 모델. 두 번째는 탐욕 디코딩, 비슷한 키도 받는다.
    # 베이스 0.5B 는 thesis_en 에 한국어를 넣기도 한다 — 영어가 아니면 버리고 다시 묻는다.
    thesis: dict | None = None
    thesis_raw = ""
    for t_try in range(2):
        thesis = call(
            THESIS_SYS,
            f"[Passage]\n{passage}\n\nReturn thesis_en and thesis_ko JSON.",
            max_tokens=256,
            t=temp if t_try == 0 else 0.0,
        )
        thesis_raw = _pick_str(thesis, "thesis_en", "thesis", "claim_en", "claim", "main_idea")
        if thesis_raw and not _has_hangul(thesis_raw):
            break
        _log_failure(
            passage=passage, stage="thesis",
            bad_output=thesis if thesis is not None else {"raw": raw_out[0][:800]},
            problem="thesis extraction failed" if not thesis_raw else "thesis_en is not English", thesis=None,
        )
        thesis_raw = ""
    lora_first: tuple[dict | None, tuple[list[str], int] | None] | None = None
    if not thesis_raw:
        # 마지막 수단: LoRA 초안의 정답 주장문을 논지로(오답 초안 단계에서 그대로 재사용).
        lora_first = lora_draft()
        if lora_first[1] is not None:
            opts, idx = lora_first[1]
            if not _has_hangul(opts[idx]):
                thesis_raw = opts[idx]
                trace.append({"stage": "thesis", "fallback": "lora_draft_answer"})
    if not thesis_raw:
        return {"ok": False, "error": "thesis stage failed", "trace": trace}
    thesis_en = thesis_raw
    thesis_ko = _pick_str(thesis, "thesis_ko", "thesis_korean", "ko")
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
        if not cand or _has_hangul(cand):  # 선지가 될 문장 — 한국어면 버린다
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
        if better and not _has_hangul(better) and _has_modal_or_adj(better) and not _starts_bad_subject(better):
            practical_en = better
            if p_try >= 1:
                break
    if not practical_en:
        practical_en = f"It is essential to act on the idea that {thesis_en[0].lower()}{thesis_en[1:]}".rstrip(".")
    print(f"[pipeline] practical: {practical_en[:120]}", file=sys.stderr)

    options: list[str] = [practical_en]
    correct_index = 0

    for draft_try in range(max_retries + 1):
        # 3) draft distractors — LoRA 가 학습한 문항 JSON 의 오답 4개를 먼저, 안 되면 베이스 + 작은 스키마
        if draft_try == 0 and lora_first is not None:
            draft, lora_qd = lora_first
        else:
            draft, lora_qd = lora_draft()
        distractors = [o for i, o in enumerate(lora_qd[0]) if i != lora_qd[1]] if lora_qd else []
        if len(distractors) != 4:
            draft = call(
                DRAFT_DIST_SYS,
                f"[Passage]\n{passage}\n\n[Thesis]\n{thesis_en}\n\n[Correct claim]\n{practical_en}\n\n"
                "Return JSON with key options (array of 4 English distractor sentences).",
                max_tokens=600,
            )
            distractors = _normalize_options((draft or {}).get("options"))
        if len(distractors) != 4:
            # 오답을 못 받으면 지어내지 않고 다시 시도한다(예전엔 특정 예문용 고정 오답으로 채웠다)
            _log_failure(
                passage=passage, stage="draft",
                bad_output=draft if draft is not None else {"raw": raw_out[0][:800]},
                problem="draft distractors invalid", thesis=thesis_obj,
            )
            trace.append({"stage": "draft", "ok": False, "out": draft})
            continue
        trace.append({"stage": "draft", "ok": True, "options": distractors})

        # 정답 자리는 해설 직전에 _shuffle_answer 로 무작위로 섞는다 — 여기서는 맨 앞에 둔다
        correct_index = 0
        options = ([practical_en] + distractors)[:5]
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

        options, correct_index = _shuffle_answer(options, correct_index)

        # 5) explanation (optional dedicated explain LoRA)
        if has_explain_adapter:
            set_adapter(model, explain_adapter)
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
                f"정답은 {CIRCLED[correct_index]}. 글의 논지는 「{thesis_ko or thesis_en}」이며, "
                f"필자는 이를 실천으로 옮겨 「{practical_en}」을 주장한다. 다른 선지는 반대 방향이거나 "
                f"이 글이 요구하지 않는 실천이다."
            )[:450]
        trace.append({"stage": "explain", "out": expl, "used_explain_adapter": has_explain_adapter})

        # 형식에 안 맞거나 겹치는 오답(짧음·You 로 시작·조동사/핵심 형용사 없음)은 지어내 채우지 않는다 —
        # 아래 형식 검사에서 걸러 다시 시도한다
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
