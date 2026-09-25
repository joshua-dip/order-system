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
import re
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
    # 내용 일치·불일치 — 모의 풀이(solve_check)만 쓴다. 오답 심사는 pipeline_fact 의 사실 확인이 맡는다.
    "match": {
        "name": "「내용 일치」(which statement agrees with the passage)",
        "question": "다음 글의 내용과 일치하는 것은?",
        "form": "English sentences, 8-20 words each",
        "not_it": "a statement the passage contradicts",
    },
    "mismatch": {
        "name": "「내용 불일치」(which statement does NOT agree with the passage)",
        "question": "다음 글의 내용과 일치하지 않는 것은?",
        "form": "English sentences, 8-20 words each",
        "not_it": "a statement the passage supports",
    },
    "blank": {
        "name": "「빈칸 추론」(fill in the blank)",
        "question": "다음 빈칸에 들어갈 말로 가장 적절한 것은?",
        "form": "English phrases that fit the blank grammatically",
        "not_it": "a phrase that fits the grammar but breaks the passage's logic",
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

# 오답끼리 내용어가 이만큼 겹치면 같은 오답으로 본다 — 35B 판정이 놓친 「It is important to keep paragraphs short …」 네 개
# (26년 9월 고1 주장 30번 0.86, 31번 0.71). 0.6 대는 서로 다른 오답이었다. 정답과의 겹침은 보지 않는다 —
# 반대 방향 오답은 정답과 단어를 많이 나눠 쓰는 게 정상이다.
NEAR_DUP = 0.7
_STOP = set(
    "the a an of to in on for and or but with by as at from that this these those is are be we should must it its our "
    "their your his her one not no any all every so than then more most very can will would may might need have has "
    "do does important essential necessary crucial vital".split()
)


def _content_words(s: str) -> set[str]:
    s = re.sub(r"^[①②③④⑤]\s*", "", s)
    return {w for w in re.findall(r"[a-z']+", s.lower()) if w not in _STOP and len(w) > 2}


def word_overlap(a: str, b: str) -> float:
    """내용어 겹침 비율 — 겹친 수 / 짧은 쪽 내용어 수."""
    ca, cb = _content_words(a), _content_words(b)
    return len(ca & cb) / max(1, min(len(ca), len(cb)))


def _verify_sys(kind: str) -> str:
    k = KINDS[kind]
    return f"""You judge each distractor of a Korean CSAT {k['name']} question against the passage.
Output ONLY one JSON object. No markdown.
Keys: verdicts (array of exactly 4 objects, same order as given: {{"i": 1-4, "verdict": "ok"|"also_correct"|"duplicate"|"off_topic", "reason": short English}}).
- also_correct: a careful student could defend it as the answer too — the correct option's idea in other words, or the passage's real main point.
- duplicate: same meaning as another distractor.
- off_topic: about a subject the passage does not discuss (e.g. "the history of …", "the economic costs of …",
  "how to …" advice, apps, careers), so a student can reject it without reading the passage closely.
- ok: plausible but clearly NOT the answer — {k['not_it']}. It uses the passage's subject and words,
  so a student must read carefully to reject it."""


def _revise_sys(kind: str, n: int) -> str:
    k = KINDS[kind]
    return f"""You write replacement distractors for a Korean CSAT {k['name']} question.
Output ONLY one JSON object. No markdown.
Keys: options (array of exactly {n} {k['form']}).
Each must be plausible but clearly NOT the answer: {k['not_it']}.
Make them tempting like real CSAT distractors: use the passage's own subject and key words, so a student has to read
carefully to reject them. Good kinds: covers only one example or detail; overstates or overgeneralizes the point;
states the opposite; the view the author argues against; a related but different issue about the same subject.
Do NOT write options about subjects the passage never discusses (its history, economic costs, health tips, careers).
Never restate the correct option in other words, and never repeat any option already listed."""


def _solve_sys(kind: str) -> str:
    return f"""You are a top Korean high-school student solving a CSAT {KINDS[kind]['name']} question. You are NOT given the answer key.
Output ONLY one JSON object. No markdown.
Keys: answer (one of ①②③④⑤ — the best answer), also_defensible (array of other circled numbers a careful student could ALSO defend as the answer; [] if none), reason (short English)."""


# 지문과 무관한 오답은 문항당 이만큼만 둔다 — 수능에도 하나쯤은 있지만, 26년 9월 고1 시험에선 「~의 역사」
# 「~의 경제적 비용」 같은 오답이 문항마다 2~4개라 읽지 않고도 지워졌다.
MAX_OFF_TOPIC = 1


def bad_distractors(dver: dict | None, n: int) -> dict[int, str]:
    """판정 JSON → {오답 위치(0~n-1): 사유} — also_correct·duplicate 전부 + off_topic 중 MAX_OFF_TOPIC 를 넘는 것.
    판정을 못 읽으면 문제 없음으로 본다(예전과 같음)."""
    out: dict[int, str] = {}
    rows = dver.get("verdicts") if isinstance(dver, dict) else None
    if not isinstance(rows, list):
        return out
    off_seen = 0
    for pos, row in enumerate(rows[:n]):
        if not isinstance(row, dict):
            continue
        verdict = str(row.get("verdict") or "").strip().lower()
        if verdict == "off_topic":
            off_seen += 1
            if off_seen <= MAX_OFF_TOPIC:
                continue
        elif verdict not in ("also_correct", "duplicate"):
            continue
        try:
            k = int(row.get("i", pos + 1)) - 1
        except (TypeError, ValueError):
            k = pos
        if 0 <= k < n:
            reason = str(row.get("reason") or "").strip()[:160]
            if verdict == "off_topic":
                reason = f"too easy — unrelated to the passage; write a tempting one on its subject. {reason}"
            out[k] = f"{verdict}: {reason}"
    return out


def count_verdicts(dver: dict | None) -> dict[str, int]:
    rows = dver.get("verdicts") if isinstance(dver, dict) else None
    out: dict[str, int] = {}
    for row in rows if isinstance(rows, list) else []:
        if isinstance(row, dict):
            v = str(row.get("verdict") or "").strip().lower()
            out[v] = out.get(v, 0) + 1
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
        # 평가(ml/eval/view.py)가 마지막 판정의 무관 오답 수를 센다
        print(f"[pipeline] distractor verdicts: {json.dumps(count_verdicts(dver))}", file=sys.stderr)
        bad = bad_distractors(dver, len(distractors))
        if form_issue:
            for k, d in enumerate(distractors):
                issue = form_issue(d, correct)
                if issue and k not in bad:
                    bad[k] = f"form: {issue}"
        for k, d in enumerate(distractors):
            if k in bad:
                continue
            for j in range(k):
                if j not in bad and word_overlap(d, distractors[j]) >= NEAR_DUP:
                    bad[k] = f"duplicate: shares most words with distractor {j + 1} ({word_overlap(d, distractors[j]):.0%})"
                    break
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


def _judge_sys(kind: str) -> str:
    return f"""You compare two candidate answers of a Korean CSAT {KINDS[kind]['name']} question.
Output ONLY one JSON object. No markdown.
Keys: better ("A" | "B" | "tie"), reason (short English).
Pick the one that covers the passage's WHOLE main point. A candidate that states only one example, one step,
or one detail of the passage is worse than one that covers the overall point, even if it is more specific."""


def _prefers(call: Call, kind: str, passage: str, first: str, second: str, trace: list[dict[str, Any]]) -> str:
    out = call(
        _judge_sys(kind),
        f"[Passage]\n{passage}\n\n[Candidate A]\n{first}\n\n[Candidate B]\n{second}\n\nReturn better, reason JSON.",
        max_tokens=120,
        t=0.0,
    )
    trace.append({"stage": "judge_answer", "out": out})
    return str((out or {}).get("better") or "").strip().upper()[:1]


def settle_answer(call: Call, *, kind: str, passage: str, options: list[str], correct_index: int,
                  options_text: str, trace: list[dict[str, Any]]) -> tuple[int, list[str]]:
    """모의 풀이가 다른 번호를 고르면, 두 선지를 순서 바꿔 두 번 비교해 둘 다 풀이 쪽이 낫다고 할 때만 정답을 옮긴다.
    제목에서 정답이 한 사례·세부로 좁게 잡힐 때(26년 9월 고1 35·37·38번) 모의 풀이는 매번 전체를 담은 선지를 골랐다 —
    경고만 띄우면 사람이 고쳐야 했다. 옮긴 원래 정답은 「세부만 다룬 오답」으로 남는다(수능 오답의 흔한 꼴).
    돌려주는 값: (정답 위치, 경고)."""
    answer = CIRCLED[correct_index]
    picked, warns, _ = _solve(call, kind=kind, passage=passage, options_text=options_text, answer=answer, trace=trace)
    if picked in CIRCLED and picked != answer:
        alt = CIRCLED.index(picked)
        a, b = options[correct_index], options[alt]
        # 순서 편향을 막으려고 두 번 — (현재, 풀이) 에선 B, (풀이, 현재) 에선 A 가 나와야 옮긴다
        if _prefers(call, kind, passage, a, b, trace) == "B" and _prefers(call, kind, passage, b, a, trace) == "A":
            print(f"[pipeline] answer moved {answer} -> {picked} (solver + judge agree)", file=sys.stderr)
            return alt, [f"정답을 {answer}에서 {picked}(으)로 옮겼습니다 — 모의 풀이·비교 판정이 모두 {picked}이(가) 글 전체를 더 잘 담는다고 봄. 확인 권장"]
    return correct_index, warns


def solve_check(call: Call, *, kind: str, passage: str, options_text: str, answer: str,
                trace: list[dict[str, Any]]) -> list[str]:
    """모의 풀이 — 다른 번호를 골랐거나 다른 선지도 정답으로 볼 수 있다고 하면 경고."""
    return _solve(call, kind=kind, passage=passage, options_text=options_text, answer=answer, trace=trace)[1]


def _solve(call: Call, *, kind: str, passage: str, options_text: str, answer: str,
           trace: list[dict[str, Any]]) -> tuple[str, list[str], str]:
    solve = call(
        _solve_sys(kind),
        f"[Passage]\n{passage}\n\n[Question]\n{KINDS[kind]['question']}\n\n[Options]\n{options_text}\n\n"
        "Return answer, also_defensible, reason JSON.",
        max_tokens=200,
        t=0.0,
    )
    trace.append({"stage": "solve", "out": solve})
    if not isinstance(solve, dict):
        return "", [], ""
    reason = str(solve.get("reason") or "").strip()[:160]
    picked = str(solve.get("answer") or "").strip()[:1]
    out: list[str] = []
    if picked in CIRCLED and picked != answer:
        out.append(f"모의 풀이(35B)가 {picked}을(를) 골랐습니다 — 정답 {answer} 확인 필요: {reason}")
    raw = solve.get("also_defensible")
    others = sorted({str(o).strip()[:1] for o in raw} & set(CIRCLED) - {answer, picked}) if isinstance(raw, list) else []
    if others:
        out.append(f"모의 풀이(35B): {'·'.join(others)}도 정답으로 볼 수 있다고 함 — 오답 확인 필요: {reason}")
    return picked, out, reason


def distinct_options(correct: str, candidates: list[str], valid: Callable[[str], bool] = lambda s: True) -> list[str]:
    """정답·서로와 같은 것, 형식(valid)에 어긋나는 것을 뺀 후보 — 순서 유지."""
    def norm(s: str) -> str:
        s = s.strip()
        if s and s[0] in CIRCLED:
            s = s[1:]
        return " ".join(s.lower().split()).rstrip(".")

    seen = {norm(correct)}
    out: list[str] = []
    for cand in candidates:
        key = norm(cand)
        if not key or key in seen or not valid(cand):
            continue
        if any(word_overlap(cand, o) >= NEAR_DUP for o in out):
            continue
        seen.add(key)
        out.append(cand)
    return out
