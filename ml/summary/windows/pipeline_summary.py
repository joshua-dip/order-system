#!/usr/bin/env python3
"""요약문 완성(summary) 파이프라인: LoRA 초안(요약문·(A)(B) 쌍 선지) → 쌍마다 「넣어 보기」 판정(순서 바꿔 두 번)
→ 정답 번호 맞추기·어긋난 쌍 다시 쓰기 → 모의 풀이 → 해설.

모델은 지문을 다시 쓰지 않고 요약문 한 줄만 적는다. 지문 + 빈 줄 + 「→ 요약문」은 코드가 합친다
(빈칸과 같은 방식 — 노트 16과). 요약문이 (A)·(B) 빈칸을 한 번씩 갖는지도 코드가 본다.

판정 규칙: 정답 쌍 = fits(요약문이 글 전체의 요지를 맞게 말함) 1개, 오답 4쌍 = wrong(문법은 맞지만 글과 어긋남).
SYSTEM_PROMPT·user_message 는 scripts/export-summary-finetune-jsonl.ts 와 한 글자까지 같아야 한다.
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

from distractor_check import solve_check  # noqa: E402
from json_extract import explanation_text, extract_json_object, trim_to_sentence  # noqa: E402
from rule_pipeline import fix_particles  # noqa: E402
from summary_draft import draft_from_spans  # noqa: E402
from summary_review import MAIN_SYS, read_core, review_main, review_candidate  # noqa: E402

CIRCLED = "①②③④⑤"
TIME_BUDGET_SEC = 150
QUESTION = "다음 글의 내용을 한 문장으로 요약하고자 한다. 빈칸 (A), (B)에 들어갈 말로 가장 적절한 것은?"
MAX_WORDS_PER_BLANK = 3

SYSTEM_PROMPT = """당신은 한국 수능 영어 변형문제 출제자입니다. 주어진 영어 지문으로 「요약문 완성」 객관식 1문항을 만듭니다.
반드시 아래 키만 갖는 JSON 한 개만 출력하세요. 마크다운·설명 금지.

키: Summary, Options, CorrectAnswer, Explanation

규칙:
1) Summary = 글 전체의 요지를 담은 영어 한 문장. 핵심 낱말 두 곳을 (A) ________ 와 (B) ________ 로 비운다((A)가 앞).
2) 빈칸 정답 낱말은 지문의 핵심 개념을 가리키되, 지문 표현을 그대로 옮기기보다 바꿔 쓴 말이 좋다.
3) Options = 선지 5개, 각 「① (A) 낱말 – (B) 낱말」 꼴, 사이는 오직 ###. 모두 영어, 각 빈칸에 문법적으로 들어가야 한다.
4) 오답은 (A)·(B) 중 하나만 맞거나 둘 다 틀린 쌍으로, 지문을 대충 읽으면 고를 만하게 만든다.
5) CorrectAnswer = ①~⑤ 중 하나.
6) Explanation = 한국어 해설, 450자 이하. (A)·(B)가 각각 지문의 어느 내용을 요약하는지 근거를 든다.
7) 지문 전체(Paragraph)는 출력하지 않는다."""


def user_message(paragraph: str) -> str:
    return f"[지문 Paragraph]\n{paragraph}"


CHECK_SYS = """You check the five options of a Korean CSAT 「summary completion」 question.
Each numbered candidate is already a COMPLETE sentence. Compare each sentence with the passage independently.
Do not choose the best sentence: every defensible sentence must be marked fits.
Output ONLY one JSON object. No markdown.
Keys: checks (array of exactly 5 objects, same order as given: {"i": 1-5, "verdict": "fits"|"wrong"|"ungrammatical", "reason": short English}).
- fits: grammatical AND the completed summary states the passage correctly (both words right).
  Synonyms and near-synonyms of the right words ALSO count as fits (copying = imitation = representation, grew = raised).
- wrong: grammatical, but the completed summary misstates the passage — one or both words point the wrong way,
  or say something the passage does not say. Do not reject a true paraphrase merely because another is more precise.
- ungrammatical: a word does not fit its blank grammatically.
Judge only by the passage."""

DRAFT35_SYS = """You write a Korean CSAT 「summary completion」 question for the passage.
Output ONLY one JSON object. No markdown.
Keys: sentence (one COMPLETE English sentence, 15-35 words, stating the WHOLE passage's main point),
A (an exact 1-3 word phrase in sentence), B (another exact 1-3 word phrase in sentence),
distractors (exactly FOUR arrays of two strings [wrong A, wrong B], 1-3 words per string).
- Write the sentence with NO blanks, underscores or (A)/(B) markers. Code will hide A and B.
- A and B must each occur EXACTLY ONCE in sentence, A before B. Choose two different central concepts.
- State the author's conclusion, including qualifications; do not merely retell an example or invent a stronger claim.
- Prefer paraphrases; do not repeat or reveal either hidden concept elsewhere in sentence.
- Each distractor must fit grammatically but make the completed sentence clearly false according to the passage.
  Keep at most one correct word; never make both words synonyms or fair alternatives of the correct pair.
Format example (invent your own content):
{"sentence":"Regular maintenance prevents equipment failures and extends the useful life of machines in demanding industrial environments.",
 "A":"prevents","B":"extends",
 "distractors":[["causes","extends"],["prevents","shortens"],["causes","shortens"],["ignores","reduces"]]}"""

REWRITE_SYS = """You rewrite ONE option of a Korean CSAT 「summary completion」 question.
Output ONLY one JSON object. No markdown.
Keys: A (one word or a short phrase of 1-3 words for blank (A)), B (the same for blank (B)).
{goal}
Both words must fit their blanks in [Summary] grammatically, and the pair must differ from the other options listed."""

GOAL_RIGHT = ("It must be the CORRECT pair: the completed summary states the passage's main point exactly. "
              "Prefer paraphrases over copying passage words.")
GOAL_WRONG = ("It must be a tempting WRONG pair: you may keep ONE word of the correct pair, but then the other word must "
              "point the OPPOSITE way (an antonym-like word) or name something the passage does not say. "
              "NEVER use a synonym or near-synonym of a correct word (abilities → talents, diversity → variation is forbidden).")

EXPLAIN_SYS = """당신은 한국 수능 영어 「요약문 완성」 문항의 한국어 해설만 씁니다.
출력은 JSON 한 개: {"Explanation": "..."} — 마크다운 금지.
- 첫 문장은 「②가 정답입니다.」 꼴로 정답 번호를 밝힌다.
- (A)·(B) 각각이 지문의 어느 내용을 요약한 말인지, 지문 표현을 짧게 인용해 근거를 든다.
- 450자 이하, 한국어로만 쓴다(영어 인용은 짧게)."""

# 빈칸 표기가 제각각이다 — (A)________ · ____(A)____ · (A) ________ · _____(A) · (A) → 모두 「(A) ________」
_BLANK = re.compile(r"_{2,}\s*\(([AB])\)\s*_{2,}|_{2,}\s*\(([AB])\)|\(([AB])\)\s*_{2,}")
_SEP = r"(?:[–—-]{1,3}|…+|\.{2,}|·{2,}|/)"


def _has_hangul(s: str) -> bool:
    return any("가" <= ch <= "힣" for ch in s)


def norm_summary(raw: str) -> str | None:
    """요약문 표기를 맞춘다. (A)·(B) 빈칸이 한 번씩, A 가 앞, 영어 한 문장(10~45단어)일 때만."""
    s = " ".join(str(raw or "").split()).strip().strip('"')
    s = re.sub(r"^(→|->|=>|⇒)\s*", "", s)
    s = _BLANK.sub(lambda m: f"({m.group(1) or m.group(2) or m.group(3)}) ________", s)
    s = re.sub(r"\(([AB])\)(?! ________)", r"(\1) ________", s)
    if s.count("(A) ________") != 1 or s.count("(B) ________") != 1 or s.index("(A)") > s.index("(B)"):
        return None
    if _has_hangul(s) or not 10 <= len(s.split()) <= 45 or "_" in s.replace("(A) ________", "").replace("(B) ________", ""):
        return None
    return s


def parse_pair(opt: str) -> tuple[str, str] | None:
    body = re.sub(r"^[①②③④⑤]\s*", "", " ".join(str(opt).split()))
    m = (re.match(rf"^\(A\)\s*(.+?)\s*{_SEP}\s*\(B\)\s*(.+)$", body)
         or re.match(rf"^(.+?)\s+{_SEP}\s+(.+)$", body))
    if not m:
        return None
    a, b = (x.strip(" .,;") for x in m.groups())
    if not a or not b or _has_hangul(a + b) or len(a.split()) > MAX_WORDS_PER_BLANK or len(b.split()) > MAX_WORDS_PER_BLANK:
        return None
    return a, b


def parse_options(raw: Any) -> list[tuple[str, str]] | None:
    if isinstance(raw, list):
        parts = [str(x) for x in raw]
    elif isinstance(raw, str):
        parts = raw.split("###") if "###" in raw else raw.split("\n") if "\n" in raw else re.split(r"(?=[①②③④⑤])", raw)
    else:
        return None
    pairs = [parse_pair(p) for p in parts if p.strip()]
    if len(pairs) != 5 or any(p is None for p in pairs):
        return None
    return pairs  # type: ignore[return-value]


def _key(p: tuple[str, str]) -> str:
    return f"{p[0].lower()}|{p[1].lower()}"


def format_options(pairs: list[tuple[str, str]]) -> str:
    return " ### ".join(f"{CIRCLED[i]} (A) {a} – (B) {b}" for i, (a, b) in enumerate(pairs))


def fill(summary: str, pair: tuple[str, str]) -> str:
    return summary.replace("(A) ________", pair[0], 1).replace("(B) ________", pair[1], 1)


def _gives_away(summary: str, pair: tuple[str, str]) -> bool:
    """정답 낱말의 앞 5글자(짧으면 전부)가 요약문 나머지에 나오면 지문을 안 읽고도 채운다."""
    rest = summary.replace("(A) ________", " ").replace("(B) ________", " ").lower()
    words = re.findall(r"[a-z]+", rest)
    for w in " ".join(pair).lower().split():
        if len(w) < 4 or w in ("more", "less", "than", "with", "from", "that", "into"):
            continue
        stem = w[:5]
        if any(x.startswith(stem) for x in words):
            return True
    return False


def _same_word(p: tuple[str, str]) -> bool:
    """(A)(B)에 같은 낱말 — 수능에 없는 모양(belief – belief)."""
    return p[0].lower() == p[1].lower()


def _verdicts(obj: dict | None) -> list[str] | None:
    rows = obj.get("checks") if isinstance(obj, dict) else None
    if not isinstance(rows, list) or len(rows) != 5:
        return None
    out = [""] * 5
    for row in rows:
        v = str((row or {}).get("verdict") or "").strip().lower() if isinstance(row, dict) else ""
        if v not in ("fits", "wrong", "ungrammatical"):
            return None
        index = row.get("i")
        if type(index) is not int or not 1 <= index <= 5 or out[index - 1]:
            return None
        out[index - 1] = v
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
) -> dict[str, Any]:
    trace: list[dict[str, Any]] = []
    started = time.time()
    if main_adapter:
        set_adapter(model, main_adapter)
    raw_out = [""]

    def call(sys_p: str, user: str, max_tokens: int = 400, *, adapter: bool = False, t: float | None = None) -> dict | None:
        raw_out[0] = chat_text(model, tokenizer, sys_p, user, max_tokens=max_tokens,
                               temp=temp if t is None else t, use_adapter=adapter)
        return extract_json_object(raw_out[0])

    core = read_core(call, passage)
    trace.append({"stage": "core", "out": core})
    if core is None:
        return {"ok": False, "error": "원문 근거가 있는 요지를 확인하지 못했습니다", "trace": trace}
    rejected_drafts: list[str] = []

    # 1) 초안 — 요약문(빈칸 둘)과 다섯 쌍이 읽혀야 쓴다. LoRA 세 번, 안 되면 35B 대안 두 번.
    #    요지가 아닌 요약문(한 사례·한 단락만)은 버리고 다시 받는다
    summary, pairs, answer = "", [], -1
    # LoRA는 두 번째부터 온도 0.7. 35B 대안은 완성 문장과 A/B 표현을 받아 코드로 가린다.
    # 모델이 빈칸 표시를 빠뜨려 좋은 내용도 형식 실패로 버리던 문제를 막는다.
    for d_try, (use_lora, t_d) in enumerate(((True, None), (True, 0.7), (True, 0.7), (False, None), (False, 0.7))):
        if time.time() - started > TIME_BUDGET_SEC:
            break
        if use_lora:
            draft = call(SYSTEM_PROMPT, user_message(passage), max_tokens=600, adapter=True, t=t_d)
            s = norm_summary((draft or {}).get("Summary") or "")
            ps = parse_options((draft or {}).get("Options"))
            ans = str((draft or {}).get("CorrectAnswer") or "").strip()[:1]
            a_i = CIRCLED.index(ans) if ans and ans in CIRCLED else -1
        else:
            draft = draft_from_spans(call(DRAFT35_SYS, f"[Passage]\n{passage}\n\n[Independent main point]\n{core['claim']}\n{core['qualification']}"
                                         + ("\n\n[Avoid these rejected summaries]\n" + "\n".join(rejected_drafts[-3:]) if rejected_drafts else "")
                                         + "\n\nReturn JSON.", max_tokens=500, t=t_d))
            s = norm_summary((draft or {}).get("summary") or "")
            raw_pairs = (draft or {}).get("pairs") or []
            ps = [parse_pair(f"(A) {x[0]} – (B) {x[1]}") if isinstance(x, list) and len(x) == 2 else None for x in raw_pairs][:5]
            ps = ps if len(ps) == 5 and all(ps) else None
            try:
                a_i = int((draft or {}).get("answer")) - 1
            except (TypeError, ValueError):
                a_i = -1
        # 같은 쌍·(A)(B) 같은 낱말은 초안을 버리지 않고 아래 다시 쓰기에서 고친다 — 정답 쌍만 멀쩡하면 된다
        ok = bool(s) and ps is not None and 0 <= a_i < 5 and not _same_word(ps[a_i])
        why = "" if ok else ("summary" if not s else "options" if ps is None else "answer")
        if ok and _gives_away(s, ps[a_i]):
            # 요약문 나머지에 정답 낱말(어간)이 그대로 — v2 20·29번(engagement … engaging, anaerobic)
            ok, why = False, f"gives away (word in summary) — {ps[a_i]}"
        if ok:
            main = review_main(call, passage, fill(s, ps[a_i]), core)
            trace.append({"stage": "main", "out": main})
            if main is None:
                ok, why = False, "main review unreadable"
            elif not all(main[k] for k in ("main_point", "supported", "grammatical")):
                ok, why = False, f"invalid summary — {str(main.get('reason') or '')[:140]}"
        trace.append({"stage": "draft", "lora": use_lora, "ok": ok, "why": why, "summary": s,
                      "raw": None if ok else raw_out[0][:400]})
        if ok:
            summary, pairs, answer = s, list(ps), a_i
            break
        if s:
            rejected_drafts.append(f"{s} — {why}")
        print(f"[pipeline] draft try={d_try} {'lora' if use_lora else '35b'} unusable ({why})", file=sys.stderr)
    if not summary:
        return {"ok": False, "error": "요약문 초안을 만들지 못했습니다 — 다시 생성해 주세요", "trace": trace}
    print(f"[pipeline] summary: {summary[:100]} · answer={CIRCLED[answer]}", file=sys.stderr)

    candidate_cache: dict[str, dict | None] = {}

    def _candidate(pair: tuple[str, str]) -> dict | None:
        sentence = fill(summary, pair)
        if sentence not in candidate_cache:
            candidate_cache[sentence] = review_candidate(call, passage, sentence)
            trace.append({"stage": "candidate", "pair": pair, "out": candidate_cache[sentence]})
        return candidate_cache[sentence]

    def _usable_wrong(pair: tuple[str, str]) -> bool:
        verdict = _candidate(pair)
        return verdict is not None and verdict["grammatical"] and not verdict["supported"]

    def check(order: list[int]) -> list[str] | None:
        got = _verdicts(call(
            CHECK_SYS,
            f"[Passage]\n{passage}\n\n[Complete candidates]\n"
            + "\n".join(f"{k + 1}. {fill(summary, pairs[j])}" for k, j in enumerate(order))
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
    unreadable = False
    remaining: dict[int, bool] = {}
    rejected: dict[int, list[str]] = {}
    verdicts: list[str] | None = None
    checked_pairs = None
    for c_try in range(max_retries + 2):
        if time.time() - started > TIME_BUDGET_SEC:
            print(f"[pipeline] time budget {TIME_BUDGET_SEC}s reached — stop rewriting", file=sys.stderr)
            break
        # 2) 넣어 보기 — 순서를 바꿔 두 번(16과), 하나라도 어긋나면 고친다
        verdicts = check([0, 1, 2, 3, 4])
        rev = check([4, 3, 2, 1, 0])
        trace.append({"stage": "check", "out": verdicts, "reversed": rev})
        checked_pairs = tuple(pairs) if verdicts is not None and rev is not None else None
        if verdicts is None:
            # 판정을 못 읽어도 아래 중복·같은 낱말·유의어 검사는 한다 — v2 39번: 이 회차를 건너뛰어 정답과 같은 쌍이 오답으로 나갔다
            print("[pipeline] check unreadable", file=sys.stderr)
            verdicts = ["wrong" if i != answer else "fits" for i in range(5)]
            rev = None
            unreadable = True
        print(f"[pipeline] check: {' '.join(v[0].upper() for v in verdicts)}"
              + (f" / reversed: {' '.join(v[0].upper() for v in rev)}" if rev else "")
              + f" answer={CIRCLED[answer]}", file=sys.stderr)
        fits = [i for i, v in enumerate(verdicts) if v == "fits"]
        fits_rev = [i for i, v in enumerate(rev) if v == "fits"] if rev else fits
        if len(fits) == 1 and fits == fits_rev and fits[0] != answer:
            moved_note = f"초안 정답 {CIRCLED[answer]} → 넣어 보기상 {CIRCLED[fits[0]]}"
            print(f"[pipeline] answer re-pointed {CIRCLED[answer]} -> {CIRCLED[fits[0]]}", file=sys.stderr)
            answer = fits[0]
        bad = _problems(verdicts, answer)
        if rev:
            for i, want in _problems(rev, answer).items():
                bad.setdefault(i, want)
        for i in range(5):  # 같은 쌍·(A)(B) 같은 낱말은 판정과 상관없이 다시 쓴다
            if i != answer and (_same_word(pairs[i]) or any(
                    _key(pairs[i]) == _key(pairs[j]) for j in range(5) if j != i and (j < i or j == answer))):
                bad[i] = False
        # 정답 쌍을 보여 주지 않고 완성 문장 자체의 사실성·문법을 따로 확인한다.
        for i in range(5):
            if i != answer and i not in bad and not _usable_wrong(pairs[i]):
                bad[i] = False
        remaining = bad
        if not bad and checked_pairs is None and c_try < max_retries + 1:
            continue  # 판독 실패를 통과로 취급하지 말고 두 순서 판정을 다시 받는다.
        if not bad or c_try >= max_retries + 1:
            break
        # 3) 다시 쓰기 — 거절된 시도를 보여 주고 두 번째부터 온도를 올린다(16과)
        for i, want_right in sorted(bad.items()):
            for attempt in range(3 if c_try == 0 else 1):
                if time.time() - started > TIME_BUDGET_SEC:
                    break
                others = [p for k, p in enumerate(pairs) if k != i]
                current = f"(A) {pairs[i][0]} – (B) {pairs[i][1]}"
                if current not in rejected.setdefault(i, []):
                    rejected[i].append(current)
                tried = rejected[i]
                rew = call(
                    REWRITE_SYS.format(goal=GOAL_RIGHT if want_right else GOAL_WRONG),
                    f"[Passage]\n{passage}\n\n[Summary]\n{summary}\n\n"
                    + (f"[Correct pair]\n(A) {pairs[answer][0]} – (B) {pairs[answer][1]}\n\n" if not want_right else "")
                    + "[Other options]\n" + "\n".join(f"- (A) {a} – (B) {b}" for a, b in others)
                    + (("\n\n[Already rejected — write something clearly different]\n"
                        + "\n".join(f"- {x}" for x in tried[-3:])) if tried else "")
                    + f"\n\n[Option to replace]\n(A) {pairs[i][0]} – (B) {pairs[i][1]}\n\nReturn JSON.",
                    max_tokens=120,
                    t=temp if attempt == 0 and not tried else 0.8,
                )
                new = parse_pair(f"(A) {(rew or {}).get('A', '')} – (B) {(rew or {}).get('B', '')}")
                ok = (new is not None and _key(new) != _key(pairs[i])
                      and all(_key(new) != _key(o) for o in others) and not _same_word(new))
                if ok and not want_right and not _usable_wrong(new):
                    ok = False  # 다시 쓴 쌍도 사실이면 복수정답, 비문이면 부적절한 오답이다.
                trace.append({"stage": "rewrite", "i": i, "right": want_right, "out": new, "ok": ok})
                if ok:
                    pairs[i] = new  # type: ignore[assignment]
                    break
                if new:
                    rejected.setdefault(i, []).append(f"(A) {new[0]} – (B) {new[1]}")
                print(f"[pipeline] rewrite {CIRCLED[i]} rejected: {new}", file=sys.stderr)

    # 미해결 복수정답·문법 오류 또는 교정 뒤 재검증하지 않은 선지는 성공으로 내보내지 않는다.
    if remaining or checked_pairs != tuple(pairs):
        return {"ok": False, "error": "선지의 정답 유일성·문법 검증을 완료하지 못했습니다", "trace": trace}
    main = review_main(call, passage, fill(summary, pairs[answer]), core)
    trace.append({"stage": "main_final", "out": main})
    if (main is None or not all(main[k] for k in ("main_point", "supported", "grammatical"))
            or _gives_away(summary, pairs[answer])):
        return {"ok": False, "error": "최종 요약문의 요지·문법·답 노출 검증에 실패했습니다", "trace": trace}

    # 정답 위치 섞기 — 쌍 순서에는 뜻이 없다(학습 데이터도 ①이 25%로 가장 많다)
    order = list(range(5))
    random.shuffle(order)
    pairs = [pairs[k] for k in order]
    answer = order.index(answer)
    remaining = {order.index(i): v for i, v in remaining.items()}

    if len({_key(p) for p in pairs}) < 5:
        return {"ok": False, "error": "같은 선지 쌍을 고치지 못했습니다 — 다시 생성해 주세요", "trace": trace}
    if any(i == answer for i in remaining):
        return {"ok": False, "error": "정답 쌍이 요약문을 맞게 채우지 못했습니다 — 다시 생성해 주세요", "trace": trace}
    warnings: list[str] = []
    if unreadable:
        warnings.append("넣어 보기 판정을 한 번 이상 읽지 못했습니다 — 선지를 직접 확인 필요")
    for i in sorted(remaining):
        warnings.append(f"선지 {CIRCLED[i]} 확인 필요 — 오답인데 요약문이 맞거나 문법이 어긋난다는 판정")
    if moved_note:
        warnings.append(f"{moved_note} — 정답 번호를 넣어 보기 판정에 맞춰 옮겼습니다")

    paragraph = f"{passage.strip()}\n\n→ {summary}"
    options_text = format_options(pairs)
    # 4) 모의 풀이 — 경고만
    warnings += solve_check(call, kind="summary", passage=paragraph, options_text=options_text,
                            answer=CIRCLED[answer], trace=trace)

    # 5) 해설 — 다른 번호를 정답이라 쓰면 한 번 더(20과)
    explanation = ""
    for t_ in (None, 0.0):
        expl = call(EXPLAIN_SYS, f"[지문과 요약문]\n{paragraph}\n\n[선지]\n{options_text}\n\n[정답]\n{CIRCLED[answer]} "
                                 f"(A) {pairs[answer][0]} – (B) {pairs[answer][1]}\n\nExplanation JSON 만 출력.",
                    max_tokens=500, t=t_)
        explanation = fix_particles(trim_to_sentence(explanation_text(expl, raw_out[0], CIRCLED[answer]), 450))
        if len(explanation) >= 40:
            break
    if len(explanation) < 40:
        a, b = pairs[answer]
        explanation = fix_particles(f"{CIRCLED[answer]}가 정답입니다. 요약문의 (A)에는 {a}, (B)에는 {b}가 들어가 글의 요지를 맞게 정리한다.")

    return {
        "ok": True,
        "question_data": {
            "Question": QUESTION,
            "Paragraph": paragraph,
            "Options": options_text,
            "CorrectAnswer": CIRCLED[answer],
            "Explanation": explanation,
            "OptionType": "English",
        },
        "warnings": warnings,
        "pipeline": {"summary": summary, "answer_moved": bool(moved_note), "unresolved": len(remaining),
                     "trace_len": len(trace)},
        "trace": trace,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="요약문 완성 파이프라인 단독 실행")
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
