"""오답 검증·교체·모의 풀이 — 주제·제목·주장 파이프라인 공용.

예전엔 오답 네 개를 한 덩어리로 ok/불합격만 받고 전부 다시 쓰게 한 뒤, 세 번째엔 판정과 상관없이 통과시켰다.
그래서 정답과 같은 뜻의 오답이 그대로 나갔다(26년 9월 고1 31번 주제 ④·⑤, 제목 ②). 지금은
  1) 오답마다 판정 — 정답으로도 읽히는(also_correct)·겹치는(duplicate) 것만 새로 쓰고,
  2) 끝까지 못 고치면 경고를 남기고,
  3) 완성된 문항을 정답 모르는 학생처럼 풀려 본다(선지 하나씩 볼 땐 괜찮아도 정답과 나란히 놓으면 더 나은 답으로
     읽히는 오답은 풀어 봐야 드러난다). 풀이는 고치지 않고 경고만 낸다.
경고는 워커 결과의 warnings 로 나가 관리자 화면 「검증 경고」에 뜬다.

call(sys, user, max_tokens, *, adapter=False, t=None) -> dict|None 는 각 파이프라인의 것(베이스/추론 모델로 돈다).
"""
from __future__ import annotations

import json
import sys
from typing import Any, Callable

CIRCLED = "①②③④⑤"

# 유형별 말 — 판정 기준은 같고 선지 모양·질문만 다르다
KINDS: dict[str, dict[str, str]] = {
    "topic": {
        "name": "「주제」(topic)",
        "question": "다음 글의 주제로 가장 적절한 것은?",
        "form": "English noun phrases, 8-15 words each, no leading ①",
        "not_it": "only a detail or example, an overstatement, the opposite, or a related but different issue",
    },
    "title": {
        "name": "「제목」(title)",
        "question": "이 글의 제목으로 가장 적절한 것은?",
        "form": "English headline phrases, 7-12 words each, each starting with a Capital Letter, no leading ①",
        "not_it": "a headline for only a detail or example, an overstatement, the opposite, or a related but different issue",
    },
    "claim": {
        "name": "「주장」(the author's claim)",
        "question": "다음 글에서 필자가 주장하는 바로 가장 적절한 것은?",
        "form": ("English sentences, 7-12 words each, each with a modal verb (should/must/need to …) or a key adjective, "
                 "not starting with You/He/She, no leading ①"),
        "not_it": ("a practice the author does not recommend — the opposite, an overstatement, a half-step-off version, "
                   "or advice about a related but different issue"),
    },
}

Call = Callable[..., "dict | None"]


def _verify_sys(kind: str) -> str:
    k = KINDS[kind]
    return f"""You judge each distractor of a Korean CSAT {k['name']} question against the passage.
Output ONLY one JSON object. No markdown.
Keys: verdicts (array of exactly 4 objects, same order as given: {{"i": 1-4, "verdict": "ok"|"also_correct"|"duplicate"|"off_topic", "reason": short English}}).
- also_correct: a careful student could defend it as the answer too — the correct option's idea in other words, or the passage's real main point.
- duplicate: same meaning as another distractor.
- off_topic: unrelated to the passage's subject, so nobody would pick it.
- ok: plausible but clearly NOT the answer — {k['not_it']}."""


def _revise_sys(kind: str, n: int) -> str:
    k = KINDS[kind]
    return f"""You write replacement distractors for a Korean CSAT {k['name']} question.
Output ONLY one JSON object. No markdown.
Keys: options (array of exactly {n} {k['form']}).
Each must be plausible but clearly NOT the answer: {k['not_it']}.
Never restate the correct option in other words, and never repeat any option already listed."""


def _solve_sys(kind: str) -> str:
    return f"""You are a top Korean high-school student solving a CSAT {KINDS[kind]['name']} question. You are NOT given the answer key.
Output ONLY one JSON object. No markdown.
Keys: answer (one of ①②③④⑤ — the best answer), also_defensible (array of other circled numbers a careful student could ALSO defend as the answer; [] if none), reason (short English)."""


def bad_distractors(dver: dict | None, n: int) -> dict[int, str]:
    """판정 JSON → {오답 위치(0~n-1): 사유} — also_correct·duplicate 만. off_topic 은 수능 오답에도 흔해 막지 않는다.
    판정을 못 읽으면 문제 없음으로 본다(예전과 같음)."""
    out: dict[int, str] = {}
    rows = dver.get("verdicts") if isinstance(dver, dict) else None
    if not isinstance(rows, list):
        return out
    for pos, row in enumerate(rows[:n]):
        if not isinstance(row, dict):
            continue
        verdict = str(row.get("verdict") or "").strip().lower()
        if verdict not in ("also_correct", "duplicate"):
            continue
        try:
            k = int(row.get("i", pos + 1)) - 1
        except (TypeError, ValueError):
            k = pos
        if 0 <= k < n:
            out[k] = f"{verdict}: {str(row.get('reason') or '').strip()[:160]}"
    return out


def fix_distractors(
    call: Call,
    *,
    kind: str,
    passage: str,
    core: str,
    options: list[str],
    correct_index: int,
    max_retries: int,
    accept: Callable[[str, list[str]], list[str]],
    normalize: Callable[[Any], list[str]],
    trace: list[dict[str, Any]],
    log_failure: Callable[..., None] | None = None,
    form_issue: Callable[[str, str], str | None] | None = None,
) -> tuple[list[str], dict[str, str]]:
    """오답마다 판정해 문제 있는 것만 새로 쓴다. 돌려주는 값: (선지 5개, 끝까지 못 고친 오답 원문 → 사유).
    accept(정답, 후보들) — 그 유형 형식에 맞고 정답·서로와 겹치지 않는 후보만 남기는 필터.
    form_issue(오답, 정답) — 모양만 봐도 바꿀 오답이면 사유(예: 너무 짧아 길이로 정답이 드러남), 아니면 None.
    판정 모델에 묻지 않고 걸러, 판정에서 문제없다고 해도 새로 쓴다."""
    options = list(options)
    flagged: dict[str, str] = {}
    for d_try in range(max_retries + 1):
        correct = options[correct_index]
        slots = [i for i in range(len(options)) if i != correct_index]
        distractors = [options[i] for i in slots]
        dver = call(
            _verify_sys(kind),
            f"[Passage]\n{passage}\n\n[Author's core point]\n{core}\n\n[Correct option]\n{correct}\n\n"
            + "[Distractors]\n" + "\n".join(f"{k + 1}. {d}" for k, d in enumerate(distractors)) + "\n\n"
            "Return verdicts JSON.",
            max_tokens=500,
        )
        trace.append({"stage": "verify_distractors", "out": dver})
        bad = bad_distractors(dver, len(distractors))
        if form_issue:
            for k, d in enumerate(distractors):
                issue = form_issue(d, correct)
                if issue and k not in bad:
                    bad[k] = f"form: {issue}"
        flagged = {distractors[k]: reason for k, reason in bad.items()}
        if not bad:
            break
        print(f"[pipeline] distractor verify: 문제 {len(bad)}개 {list(bad.values())}", file=sys.stderr)
        if log_failure:
            log_failure(stage="verify_distractors", bad_output={"distractors": distractors, "verify": dver},
                        problem="; ".join(bad.values()))
        if d_try >= max_retries:
            break
        keep = [d for k, d in enumerate(distractors) if k not in bad]
        rev = call(
            _revise_sys(kind, len(bad)),
            f"[Passage]\n{passage}\n\n[Author's core point]\n{core}\n\n"
            f"[Correct option — do not restate]\n{correct}\n\n"
            f"[Options already used]\n{json.dumps([correct] + distractors, ensure_ascii=False)}\n\n"
            f"[Why the replaced ones failed]\n{json.dumps(list(bad.values()), ensure_ascii=False)}\n\n"
            f"Return options JSON with exactly {len(bad)} new distractors.",
            max_tokens=300,
        )
        trace.append({"stage": "revise_distractors", "out": rev})
        fresh = [f for f in accept(correct, keep + normalize((rev or {}).get("options"))) if f not in keep]
        # 문제 선지 자리만 새것으로(모자라면 그 자리는 두고 다음 판정에서 다시 본다)
        for k in sorted(bad):
            if fresh:
                options[slots[k]] = fresh.pop(0)
    return options, flagged


def flagged_warnings(flagged: dict[str, str], options: list[str]) -> list[str]:
    """끝까지 못 고친 오답 → 최종 번호로 쓴 경고(정답 섞은 뒤에 부른다)."""
    return [
        f"오답 {CIRCLED[options.index(text)]} 확인 필요 — "
        + ("형식: " if reason.startswith("form:") else "정답으로도 읽히거나 다른 오답과 겹칠 수 있음: ")
        + reason.removeprefix("form: ")
        for text, reason in flagged.items()
        if text in options
    ]


def solve_check(call: Call, *, kind: str, passage: str, options_text: str, answer: str,
                trace: list[dict[str, Any]]) -> list[str]:
    """모의 풀이 — 다른 번호를 골랐거나 다른 선지도 정답으로 볼 수 있다고 하면 경고."""
    solve = call(
        _solve_sys(kind),
        f"[Passage]\n{passage}\n\n[Question]\n{KINDS[kind]['question']}\n\n[Options]\n{options_text}\n\n"
        "Return answer, also_defensible, reason JSON.",
        max_tokens=200,
        t=0.0,
    )
    trace.append({"stage": "solve", "out": solve})
    if not isinstance(solve, dict):
        return []
    reason = str(solve.get("reason") or "").strip()[:160]
    picked = str(solve.get("answer") or "").strip()[:1]
    out: list[str] = []
    if picked in CIRCLED and picked != answer:
        out.append(f"모의 풀이(35B)가 {picked}을(를) 골랐습니다 — 정답 {answer} 확인 필요: {reason}")
    raw = solve.get("also_defensible")
    others = sorted({str(o).strip()[:1] for o in raw} & set(CIRCLED) - {answer, picked}) if isinstance(raw, list) else []
    if others:
        out.append(f"모의 풀이(35B): {'·'.join(others)}도 정답으로 볼 수 있다고 함 — 오답 확인 필요: {reason}")
    return out


def distinct_options(correct: str, candidates: list[str], valid: Callable[[str], bool] = lambda s: True) -> list[str]:
    """정답·서로와 같은 것, 형식(valid)에 어긋나는 것을 뺀 후보 — 순서 유지."""
    def norm(s: str) -> str:
        s = s.strip()
        if s[:1] in CIRCLED:
            s = s[1:]
        return " ".join(s.lower().split()).rstrip(".")

    seen = {norm(correct)}
    out: list[str] = []
    for cand in candidates:
        key = norm(cand)
        if not key or key in seen or not valid(cand):
            continue
        seen.add(key)
        out.append(cand)
    return out
