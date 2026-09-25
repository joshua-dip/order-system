#!/usr/bin/env python3
"""빈칸 추론(blank) 파이프라인: LoRA 초안(가릴 구절·선지) → 빈칸 뚫기 → 선지별 「넣어 보기」 판정(순서 바꿔 두 번)
→ 정답 번호 맞추기·어긋난 선지 다시 쓰기 → 모의 풀이 → 해설.

모델은 빈칸 뚫린 지문을 다시 쓰지 않고 「가릴 구절(Blank)」만 적는다. 그 구절이 지문에 그대로 있는지는 코드가 본다
(없으면 초안을 버린다) — 빈칸 뚫기도 코드가 한다.

판정 규칙: 정답 = fits(문법·글의 흐름 모두 맞음) 1개, 오답 4개 = wrong(문법은 맞지만 흐름과 어긋남).
ungrammatical 오답은 다시 쓴다 — 문법만 보고 지울 수 있는 오답은 수능 오답이 아니다.
SYSTEM_PROMPT·user_message 는 scripts/export-blank-finetune-jsonl.ts 와 한 글자까지 같아야 한다.
"""
from __future__ import annotations

import argparse
import json
import random
import re
import sys
import time
from pathlib import Path
from typing import Any

_TYPE_DIR = Path(__file__).resolve().parent.parent
_WIN_DIR = Path(__file__).resolve().parent
for p in (_TYPE_DIR, _WIN_DIR):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

from _cuda_runtime import (  # noqa: E402
    DEFAULT_ADAPTER,
    DEFAULT_MODEL,
    adapter_exists,
    chat_text,
    load_base_model_name,
    load_model,
    resolve_use_4bit,
    set_adapter,
)

from distractor_check import solve_check, word_overlap  # noqa: E402
from json_extract import explanation_text, extract_json_object, trim_to_sentence  # noqa: E402

CIRCLED = "①②③④⑤"
# 빈칸 선지는 같은 문장 틀에 들어가야 해서 짧고 단어를 원래 많이 나눠 쓴다(「was the only true/acceptable
# definition of art」) — 주제·제목 오답의 0.7 로는 멀쩡한 오답을 겹침으로 잘랐다. 거의 같은 말만 겹침으로 본다.
DUP = 0.9
MAX_SPAN_WORDS = 20
TIME_BUDGET_SEC = 150  # 문항 하나에 쓸 시간 — 넘으면 다시 쓰기를 멈춘다
REDRAFT_WITHIN_SEC = 90  # 치명적 결함이 남았을 때 처음부터 다시 만드는 건 이 시간 안일 때만
QUESTION = "다음 빈칸에 들어갈 말로 가장 적절한 것은?"
BLANK = "<u>_____</u>"

SYSTEM_PROMPT = """당신은 한국 수능 영어 변형문제 출제자입니다. 주어진 영어 지문으로 「빈칸 추론」 객관식 1문항을 만듭니다.
반드시 아래 키만 갖는 JSON 한 개만 출력하세요. 마크다운·설명 금지.

키: Blank, Options, CorrectAnswer, Explanation

규칙:
1) Blank = 빈칸으로 가릴 지문의 구절. 지문에 있는 그대로 한 글자도 바꾸지 않고 옮긴다. 글의 핵심(요지)을 담은 구절을 고른다.
2) Options = 빈칸에 넣을 영어 구절 5개, 각 앞에 ①~⑤, 사이는 오직 ###. 다섯 모두 빈칸 자리에 문법적으로 들어가야 한다.
3) 정답 선지는 Blank 와 뜻이 같다(그대로 또는 풀어 쓴 말). 오답 4개는 지문의 말을 쓰되 글의 흐름과 어긋난다(반대, 한 사례만, 다른 주장).
4) CorrectAnswer = ①~⑤ 중 하나.
5) Explanation = 한국어 해설, 450자 이하. 빈칸 앞뒤 문맥을 근거로 정답을 설명한다.
6) 지문 전체(Paragraph)는 출력하지 않는다."""


def user_message(paragraph: str) -> str:
    return f"[지문 Paragraph]\n{paragraph}"


CHECK_SYS = """You check the five options of a Korean CSAT fill-in-the-blank question. Put each option into the blank marked <u>_____</u> and read the passage.
Output ONLY one JSON object. No markdown.
Keys: checks (array of exactly 5 objects, same order as given: {"i": 1-5, "verdict": "fits"|"wrong"|"ungrammatical", "reason": short English}).
- fits: grammatical in the blank AND it says what the passage's logic requires at that point (the surrounding sentences support it).
- wrong: grammatical, but it breaks the passage's logic — the opposite, only a side detail, the view the passage rejects, or something the context does not support.
- ungrammatical: it does not fit the sentence grammatically.
Judge only by the passage."""

REWRITE_SYS = """You rewrite ONE option of a Korean CSAT fill-in-the-blank question.
Output ONLY one JSON object. No markdown.
Keys: option (one English phrase that fits the blank grammatically, {lo}-{hi} words).
{goal}
It must fit the sentence around <u>_____</u> grammatically and be different from the other options listed."""

GOAL_RIGHT = ("It must be the CORRECT answer: the same meaning as [Original phrase], in different words where possible, "
              "so the passage reads exactly as the author meant.")
GOAL_WRONG = ("It must be a tempting WRONG answer: use the passage's own words, but make it break the logic at the blank — "
              "the opposite, only one example or detail, or the view the passage argues against. "
              "Never write something that could also be correct.")

GIST_SYS = """You judge the blank of a Korean CSAT fill-in-the-blank question.
CSAT blanks cover the passage's KEY POINT: the author's main claim, or the idea the whole passage builds to
(often a restatement of the topic sentence or the conclusion). A blank on an example, a number, a name, a date,
a list item or a side detail is bad: many options could fit it, and it tests memory rather than understanding.
Output ONLY one JSON object. No markdown.
Keys: key_point (true|false), reason (short English), better_phrase (if key_point is false: a phrase of 4-20 words copied EXACTLY from the passage that states the key point; otherwise empty string)."""

PICK_SYS = """You choose the blank for a Korean CSAT fill-in-the-blank question.
Output ONLY one JSON object. No markdown.
Keys: phrase (4-20 words copied EXACTLY from the passage — same spelling, punctuation and contractions — that states the passage's key point: the author's main claim or the idea the passage builds to; never an example, number, name or side detail)."""

OPTIONS_SYS = """You write the five options of a Korean CSAT fill-in-the-blank question.
Output ONLY one JSON object. No markdown.
Keys: options (array of exactly 5 English phrases), answer (1-5, the position of the correct option).
- The correct option means the same as [Original phrase] (keep it or paraphrase it lightly).
- The four wrong options must fit the sentence around <u>_____</u> grammatically and use the passage's own words,
  but break its logic: the opposite, only one example or detail, the view the author rejects, or an overstatement.
- Never write a wrong option that could also be correct. Keep all five about the same length."""

EXPLAIN_SYS = """당신은 한국 수능 영어 「빈칸 추론」 문항의 한국어 해설만 씁니다.
출력은 JSON 한 개: {"Explanation": "..."} — 마크다운 금지.
- 첫 문장은 「정답은 ①.」 꼴로 정답 번호를 밝힌다.
- 빈칸 앞뒤 문맥(지문 표현을 짧게 인용)을 근거로 정답이 왜 들어가는지 설명한다.
- 오답 두세 개가 왜 흐름과 어긋나는지 한 줄씩 든다.
- 450자 이하, 한국어로만 쓴다(영어 인용은 짧게)."""


def _strip_circled(opt: str) -> str:
    s = opt.strip()
    # s[:1] 로 물으면 빈 문자열('')이 「들어 있다」가 돼 번호만 있는 선지(「①」)에서 영원히 돈다 — 한 문항이 20분 멈췄다
    while s and s[0] in CIRCLED:
        s = s[1:].strip()
    return s.lstrip(".) ").strip()


def _normalize_options(raw: Any) -> list[str]:
    if isinstance(raw, list):
        parts = [str(x) for x in raw]
    elif isinstance(raw, str):
        if "###" in raw:
            parts = raw.split("###")
        elif "\n" in raw:
            parts = raw.split("\n")
        else:
            parts = re.split(r"(?=[①②③④⑤])", raw)
    else:
        return []
    return [_strip_circled(p) for p in parts if _strip_circled(p)]


def _format_options(opts: list[str]) -> str:
    return " ### ".join(f"{CIRCLED[i]} {o}" for i, o in enumerate(opts))


def _has_hangul(s: str) -> bool:
    return any("가" <= ch <= "힣" for ch in s)


def blank_out(passage: str, span: str) -> str | None:
    """지문에서 span 을 찾아 빈칸으로 — 공백·줄바꿈 차이는 허용, 글자는 그대로여야 한다. 못 찾으면 None."""
    span = " ".join(span.split()).strip()
    if not span or len(span.split()) < 2:
        return None
    # 둥근·곧은 따옴표 차이는 같은 글자로 본다(DB 지문은 ’·“ 를, 모델은 '·" 를 쓰곤 한다)
    def word_pat(w: str) -> str:
        out = re.escape(w)  # 따옴표는 re.escape 가 건드리지 않는다
        out = re.sub("['\u2019\u2018]", "['\u2019\u2018]", out)
        return re.sub('["\u201c\u201d]', '["\u201c\u201d]', out)

    pattern = r"\s+".join(word_pat(w) for w in span.split())
    m = re.search(pattern, passage)
    if not m:
        return None
    return passage[: m.start()] + BLANK + passage[m.end():]


def _same(a: str, b: str) -> bool:
    """대소문자·문장부호·공백만 다르면 같은 말."""
    key = lambda x: " ".join(re.sub(r"[^\w\s']", " ", x.lower()).split())
    return key(a) == key(b)


def _valid_option(s: str, lo: int, hi: int) -> bool:
    return lo <= len(s.split()) <= hi and not _has_hangul(s)


def _verdicts(obj: dict | None) -> list[str] | None:
    rows = obj.get("checks") if isinstance(obj, dict) else None
    if not isinstance(rows, list) or len(rows) < 5:
        return None
    out = []
    for row in rows[:5]:
        v = str((row or {}).get("verdict") or "").strip().lower() if isinstance(row, dict) else ""
        if v not in ("fits", "wrong", "ungrammatical"):
            return None
        out.append(v)
    return out


def _problems(verdicts: list[str], answer: int) -> dict[int, bool]:
    """역할과 판정이 어긋난 선지 → {위치: 정답으로 다시 쓸지(True)/오답으로(False)}."""
    bad: dict[int, bool] = {}
    for i, v in enumerate(verdicts):
        if i == answer and v != "fits":
            bad[i] = True
        elif i != answer and v != "wrong":
            bad[i] = False
    return bad


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
    _second_try: bool = False,
) -> dict[str, Any]:
    trace: list[dict[str, Any]] = []
    # 문항 하나의 시간 한도 — 다시 쓰기가 계속 거절되면 확인 4번 × 선지당 3번 × 재생성까지 100번 넘게 불러
    # 한 문항에 20분이 걸렸다(23번). 한도를 넘으면 다시 쓰기를 멈추고 경고를 붙여 마무리한다
    started = time.time()
    if main_adapter:
        set_adapter(model, main_adapter)
    raw_out = [""]

    def call(sys_p: str, user: str, max_tokens: int = 400, *, adapter: bool = False, t: float | None = None) -> dict | None:
        raw_out[0] = chat_text(model, tokenizer, sys_p, user, max_tokens=max_tokens,
                               temp=temp if t is None else t, use_adapter=adapter)
        return extract_json_object(raw_out[0])

    # 1) 초안 — 가릴 구절이 지문에 그대로 있어야 쓴다. LoRA 두 번, 안 되면 35B 가 같은 지시문으로
    span, blanked, options, answer = "", None, [], -1
    for d_try, use_lora in enumerate((True, True, False)):
        draft = call(SYSTEM_PROMPT, user_message(passage), max_tokens=700, adapter=use_lora)
        span = " ".join(str((draft or {}).get("Blank") or "").split())
        blanked = blank_out(passage, span)
        opts = _normalize_options((draft or {}).get("Options"))
        ans = str((draft or {}).get("CorrectAnswer") or "").strip()[:1]
        # 20단어 넘는 빈칸은 선지가 문장 틀을 그대로 베껴 같은 선지가 여럿 나왔다(23·37번) — 초안을 다시 받는다
        too_long = blanked is not None and len(span.split()) > MAX_SPAN_WORDS
        if too_long:
            blanked = None
        ok = blanked is not None and len(opts) == 5 and ans in CIRCLED
        trace.append({"stage": "draft", "lora": use_lora, "ok": ok, "span": span})
        if ok:
            options, answer = opts, CIRCLED.index(ans)
            break
        why = ("blank too long" if too_long else "blank not in passage") if blanked is None else f"options={len(opts)} answer={ans!r}"
        print(f"[pipeline] draft try={d_try} unusable ({why}): {span[:60]}", file=sys.stderr)
    if not options or blanked is None:
        # 초안이 세 번 다 못 쓰면(구절을 살짝 바꿔 옮김·너무 김) 35B 가 요지 구절을 원문에서 골라 선지를 쓴다(35번)
        picked = call(PICK_SYS, f"[Passage]\n{passage}\n\nReturn JSON.", max_tokens=200, t=0.0)
        phrase = " ".join(str((picked or {}).get("phrase") or "").split())
        pb = blank_out(passage, phrase) if phrase else None
        made = None
        if pb and 4 <= len(phrase.split()) <= MAX_SPAN_WORDS:
            made = call(OPTIONS_SYS, f"[Passage with the blank]\n{pb}\n\n[Original phrase]\n{phrase}\n\nReturn options JSON.",
                        max_tokens=400)
        opts3 = [_strip_circled(str(o)) for o in ((made or {}).get("options") or [])][:5]
        try:
            ans3 = int((made or {}).get("answer")) - 1
        except (TypeError, ValueError):
            ans3 = -1
        trace.append({"stage": "draft_fallback", "phrase": phrase, "ok": len(opts3) == 5 and 0 <= ans3 < 5})
        if not (pb and len(opts3) == 5 and all(opts3) and 0 <= ans3 < 5):
            return {"ok": False, "error": "draft stage failed", "trace": trace}
        print(f"[pipeline] draft fallback (35B picked key phrase): {phrase[:70]}", file=sys.stderr)
        span, blanked, options, answer = phrase, pb, opts3, ans3
    print(f"[pipeline] blank ({len(span.split())} words): {span[:80]} · answer={CIRCLED[answer]}", file=sys.stderr)

    # 1-1) 요지 필터 — 예시·숫자·세부를 뚫으면 다른 선지도 말이 돼 정답이 둘이 된다(23번 「식량 급감이나 기온 급상승」,
    #      35번 「한 주에 한두 번」). 요지가 아니면 35B 가 고른 요지 구절로 바꾸고 선지를 새로 쓴다
    gist = call(GIST_SYS, f"[Passage with the blank]\n{blanked}\n\n[Blanked phrase]\n{span}\n\nReturn JSON.",
                max_tokens=200, t=0.0)
    trace.append({"stage": "gist", "out": gist})
    gist_note = ""
    if isinstance(gist, dict) and gist.get("key_point") is False:
        better = " ".join(str(gist.get("better_phrase") or "").split())
        new_blanked = blank_out(passage, better) if better else None
        if new_blanked and 4 <= len(better.split()) <= MAX_SPAN_WORDS and not _same(better, span):
            made = call(
                OPTIONS_SYS,
                f"[Passage with the blank]\n{new_blanked}\n\n[Original phrase]\n{better}\n\nReturn options JSON.",
                max_tokens=400,
            )
            opts2 = [_strip_circled(str(o)) for o in ((made or {}).get("options") or [])][:5]
            try:
                ans2 = int((made or {}).get("answer")) - 1
            except (TypeError, ValueError):
                ans2 = -1
            if len(opts2) == 5 and all(opts2) and 0 <= ans2 < 5:
                print(f"[pipeline] gist: detail blank replaced — {span[:50]} → {better[:60]}", file=sys.stderr)
                gist_note = f"빈칸을 요지 구절로 바꿨습니다(초안: 「{span[:60]}」 — {str(gist.get('reason') or '')[:80]})"
                span, blanked, options, answer = better, new_blanked, opts2, ans2
            else:
                print("[pipeline] gist: options for key phrase unusable — keep draft blank", file=sys.stderr)
        else:
            print(f"[pipeline] gist: not key point but no usable phrase ({better[:60]!r}) — keep draft blank", file=sys.stderr)
    elif isinstance(gist, dict):
        print("[pipeline] gist: key point ok", file=sys.stderr)

    # 선지 길이 범위 — 가린 구절 길이를 기준으로(너무 짧거나 긴 선지는 길이로 답이 드러난다)
    n = len(span.split())
    lo, hi = max(1, n // 2), max(n * 2, n + 6)

    def check(order: list[int]) -> list[str] | None:
        got = _verdicts(call(
            CHECK_SYS,
            f"[Passage]\n{blanked}\n\n[Options]\n" + "\n".join(f"{k + 1}. {options[j]}" for k, j in enumerate(order))
            + "\n\nReturn checks JSON.",
            max_tokens=600, t=0.0,
        ))
        if got is None:
            return None
        back = [""] * 5
        for k, j in enumerate(order):
            back[j] = got[k]
        return back

    moved_note = ""
    remaining: dict[int, bool] = {}
    rejected: dict[int, list[str]] = {}
    verdicts: list[str] | None = None
    for c_try in range(max_retries + 2):
        if time.time() - started > TIME_BUDGET_SEC:
            print(f"[pipeline] time budget {TIME_BUDGET_SEC}s reached — stop rewriting", file=sys.stderr)
            break
        # 2) 넣어 보기 — 순서를 바꿔 두 번(내용일치 16과: 놓인 순서에 따라 판정이 달라진다), 하나라도 어긋나면 고친다
        verdicts = check([0, 1, 2, 3, 4])
        rev = check([4, 3, 2, 1, 0])
        trace.append({"stage": "check", "out": verdicts, "reversed": rev})
        if verdicts is None:
            print("[pipeline] check unreadable", file=sys.stderr)
            continue
        print(f"[pipeline] check: {' '.join(v[0].upper() for v in verdicts)}"
              + (f" / reversed: {' '.join(v[0].upper() for v in rev)}" if rev else "")
              + f" answer={CIRCLED[answer]}", file=sys.stderr)
        fits = [i for i, v in enumerate(verdicts) if v == "fits"]
        fits_rev = [i for i, v in enumerate(rev) if v == "fits"] if rev else fits
        # 원문 구절과 글자까지 같은 선지는 무조건 정답이다 — 판정이 「month」도 맞는다고 해서 원문 「week」를
        # 오답으로 두고 번호를 옮긴 일이 있었다(35번). 그런 선지가 있으면 판정으로 번호를 옮기지 않는다
        verbatim = [i for i, o in enumerate(options) if _same(o, span)]
        if verbatim:
            if answer not in verbatim:
                moved_note = f"초안 정답 {CIRCLED[answer]} → 원문 구절 그대로인 {CIRCLED[verbatim[0]]}"
                print(f"[pipeline] answer set to verbatim option {CIRCLED[verbatim[0]]}", file=sys.stderr)
                answer = verbatim[0]
        elif len(fits) == 1 and fits == fits_rev and fits[0] != answer:
            moved_note = f"초안 정답 {CIRCLED[answer]} → 넣어 보기상 {CIRCLED[fits[0]]}"
            print(f"[pipeline] answer re-pointed {CIRCLED[answer]} -> {CIRCLED[fits[0]]}", file=sys.stderr)
            answer = fits[0]
        bad = _problems(verdicts, answer)
        if rev:
            for i, want in _problems(rev, answer).items():
                bad.setdefault(i, want)
        # 오답끼리 거의 같은 말, 정답과 같은 말(원문 구절 그대로인 오답 포함)은 판정과 상관없이 다시 쓴다
        for i in range(5):
            if i == answer:
                continue
            if (_same(options[i], options[answer]) or _same(options[i], span)
                    or any(j != answer and word_overlap(options[i], options[j]) >= DUP for j in range(i))):
                bad[i] = False
        remaining = bad
        if not bad or c_try >= max_retries + 1:
            break
        # 3) 다시 쓰기
        for i, want_right in sorted(bad.items()):
            # 한 자리에 세 번까지 — 거절된 시도를 보여 주고 두 번째부터 온도를 올린다(35B 가 같은 문장을 되풀이했다)
            # 첫 라운드만 세 번, 그 뒤엔 한 번 — 호출 수 상한
            for attempt in range(3 if c_try == 0 else 1):
                if time.time() - started > TIME_BUDGET_SEC:
                    break
                others = [o for k, o in enumerate(options) if k != i]
                tried = rejected.get(i, [])
                rew = call(
                    REWRITE_SYS.format(lo=lo, hi=hi, goal=GOAL_RIGHT if want_right else GOAL_WRONG),
                    f"[Passage with the blank]\n{blanked}\n\n[Original phrase]\n{span}\n\n[Other options]\n"
                    + "\n".join(f"- {o}" for o in others)
                    + (("\n\n[Already rejected — too close to another option; write something clearly different]\n"
                        + "\n".join(f"- {x}" for x in tried[-3:])) if tried else "")
                    + f"\n\n[Option to replace]\n{options[i]}\n\nReturn option JSON.",
                    max_tokens=120,
                    t=temp if attempt == 0 and not tried else 0.8,
                )
                new = _strip_circled(str((rew or {}).get("option") or ""))
                ok = (bool(new) and _valid_option(new, lo, hi)
                      and all(word_overlap(new, o) < DUP and new.lower() != o.lower() for o in others))
                trace.append({"stage": "rewrite", "i": i, "right": want_right, "out": new, "ok": ok})
                if ok:
                    options[i] = new
                    break
                if new:
                    rejected.setdefault(i, []).append(new)
                print(f"[pipeline] rewrite {CIRCLED[i]} rejected: {new[:70]}", file=sys.stderr)

    # 정답 위치 섞기 — 초안은 정답을 ①에 두는 버릇이 있다(36문항 중 25개). 빈칸은 선지 순서에 뜻이 없으니 섞는다
    # (경고의 선지 번호가 섞은 뒤 번호가 되게 경고보다 먼저)
    order = list(range(5))
    random.shuffle(order)
    options = [options[k] for k in order]
    answer = order.index(answer)

    remaining = {order.index(i): v for i, v in remaining.items()}
    # 끝까지 못 고친 치명적 결함(같은 선지 둘, 원문 구절 그대로인 오답)은 내보내지 않고 처음부터 한 번 더 만든다
    # (37번: 「the Sun traveled around Earth」 셋이 남았다). 경고로 넘기면 정답이 둘인 문항이 저장될 수 있다.
    keys = [" ".join(re.sub(r"[^\w\s']", " ", o.lower()).split()) for o in options]
    fatal = len(set(keys)) < 5 or any(_same(o, span) for k, o in enumerate(options) if k != answer)
    if fatal:
        print("[pipeline] duplicate / verbatim distractor left — " + ("giving up" if _second_try else "drafting again"),
              file=sys.stderr)
        if not _second_try and time.time() - started < REDRAFT_WITHIN_SEC:
            return run_pipeline(model, tokenizer, passage, max_retries=max_retries, temp=temp,
                                has_explain_adapter=has_explain_adapter, main_adapter=main_adapter,
                                explain_adapter=explain_adapter, _second_try=True)
        return {"ok": False, "error": "같은 선지·원문 그대로인 오답을 고치지 못했습니다 — 다시 생성해 주세요", "trace": trace}
    warnings: list[str] = []
    if verdicts is None:
        warnings.append("넣어 보기 판정을 읽지 못했습니다 — 선지를 직접 확인 필요")
    for i, want_right in sorted(remaining.items()):
        warnings.append(f"선지 {CIRCLED[i]} 확인 필요 — "
                        + ("정답인데 빈칸에 맞지 않는다는 판정" if want_right else "오답인데 빈칸에 맞거나 문법이 어긋난다는 판정"))
    if moved_note:
        warnings.append(f"{moved_note} — 정답 번호를 넣어 보기 판정에 맞춰 옮겼습니다")
    if gist_note:
        warnings.append(gist_note)

    # 4) 모의 풀이 — 빈칸 뚫린 지문으로, 경고만
    warnings += solve_check(call, kind="blank", passage=blanked, options_text=_format_options(options),
                            answer=CIRCLED[answer], trace=trace)

    # 5) 해설
    expl = call(
        EXPLAIN_SYS,
        f"[빈칸 지문]\n{blanked}\n\n[원래 구절]\n{span}\n\n[문제]\n{QUESTION}\n\n[선지]\n{_format_options(options)}\n\n"
        f"[정답]\n{CIRCLED[answer]}\n\nExplanation JSON 만 출력.",
        max_tokens=500,
    )
    explanation = trim_to_sentence(explanation_text(expl, raw_out[0], CIRCLED[answer]), 450)
    if len(explanation) < 40:
        explanation = f"정답은 {CIRCLED[answer]}. 빈칸에는 원래 「{span}」이 들어가 앞뒤 문맥과 이어진다."[:450]

    qd = {
        "Question": QUESTION,
        "Paragraph": blanked,
        "Options": _format_options(options),
        "CorrectAnswer": CIRCLED[answer],
        "Explanation": explanation,
        "OptionType": "English",
    }
    return {
        "ok": True,
        "question_data": qd,
        "warnings": warnings,
        "pipeline": {"blank": span, "answer_moved": bool(moved_note), "gist_replaced": bool(gist_note),
                     "unresolved": len(remaining),
                     "trace_len": len(trace)},
        "trace": trace,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="빈칸 추론 파이프라인 단독 실행")
    ap.add_argument("--passage-file", required=True)
    ap.add_argument("--adapter", default=str(DEFAULT_ADAPTER))
    ap.add_argument("--model", default="")
    args = ap.parse_args()
    passage = Path(args.passage_file).read_text(encoding="utf-8").strip()
    adapter = Path(args.adapter)
    model_name = args.model or load_base_model_name(adapter, DEFAULT_MODEL)
    model, tok, _ = load_model(model_name, adapter if adapter_exists(adapter) else None, resolve_use_4bit(adapter, False))
    res = run_pipeline(model, tok, passage)
    res.pop("trace", None)
    print(json.dumps(res, ensure_ascii=False, indent=1))
    return 0 if res.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
