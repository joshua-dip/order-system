#!/usr/bin/env python3
"""내용 일치·불일치(fact) 파이프라인: LoRA 초안 → 선지별 사실 확인 → 정답 번호 맞추기·어긋난 선지 다시 쓰기
→ 지문 순서 맞추기 → 모의 풀이 → 해설.

주제·제목·주장은 「글 전체의 요지를 담았나」라는 판단 문제라 35B 에게 뜻을 묻는다. 내용일치는 선지마다
지문과 맞는지 틀리는지 하나씩 가릴 수 있는 사실 문제다 — 그래서 선지마다 참(true)·거짓(false)·언급 없음
(not_given)과 근거 구절을 받아, 역할(정답/오답)과 판정이 어긋난 것만 고친다.

  일치  : 정답 = 참 1개, 나머지 4개 = 거짓 (언급 없음은 수능에서 시비가 나기 쉬워 거짓으로 다시 쓴다)
  불일치: 정답 = 거짓 1개, 나머지 4개 = 참

LoRA 는 일치·불일치를 하나로 배웠다(사용자 메시지의 [유형] 줄로 구분). 출력에 Paragraph 가 없다 —
지문은 여기서 채운다. SYSTEM_PROMPT·user_message 는 scripts/export-fact-finetune-jsonl.ts 와 한 글자까지 같아야 한다.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path
from typing import Any

_TYPE_DIR = Path(__file__).resolve().parent.parent
_WIN_DIR = Path(__file__).resolve().parent
_ROOT = _TYPE_DIR.parent.parent
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

from distractor_check import NEAR_DUP, solve_check, word_overlap  # noqa: E402
from json_extract import explanation_text, extract_json_object, trim_to_sentence  # noqa: E402

CIRCLED = "①②③④⑤"
TIME_BUDGET_SEC = 150  # 문항 하나에 쓸 시간 — 넘으면 다시 쓰기를 멈추고 경고를 붙여 마무리
KINDS = ("일치", "불일치")
QUESTION = {"일치": "다음 글의 내용과 일치하는 것은?", "불일치": "다음 글의 내용과 일치하지 않는 것은?"}

SYSTEM_PROMPT = """당신은 한국 수능 영어 변형문제 출제자입니다. 주어진 영어 지문으로 「내용 일치」 또는 「내용 불일치」 객관식 1문항을 만듭니다.
반드시 아래 키만 갖는 JSON 한 개만 출력하세요. 마크다운·설명 금지.

키: Question, Options, CorrectAnswer, Explanation, OptionType

규칙:
1) [유형]이 일치면 Question = "다음 글의 내용과 일치하는 것은?", 정답 1개만 지문과 맞고 나머지 4개는 지문과 어긋난다.
   [유형]이 불일치면 Question = "다음 글의 내용과 일치하지 않는 것은?", 정답 1개만 지문과 어긋나고 나머지 4개는 지문과 맞는다.
2) Options = 영어 완전한 문장 5개, 각 앞에 ①~⑤, 사이는 오직 ###. 지문에 나오는 차례대로 배열한다.
3) 어긋나는 선지는 지문의 한 부분을 바꿔(반대로, 다른 대상으로, 과장해서) 만든다. 지문에 없는 내용을 지어내지 않는다.
4) OptionType = "English"
5) CorrectAnswer = ①~⑤ 중 하나.
6) Explanation = 한국어 해설, 450자 이하. 정답 선지가 지문의 어느 부분과 맞는지/어긋나는지 근거를 든다.
7) Paragraph 는 출력하지 않는다."""


def user_message(kind: str, paragraph: str) -> str:
    return f"[유형] {kind}\n\n[지문 Paragraph]\n{paragraph}"


CHECK_SYS = """You fact-check the five answer options of a Korean CSAT reading question against the passage.
Output ONLY one JSON object. No markdown.
Keys: checks (array of exactly 5 objects, same order as given: {"i": 1-5, "verdict": "true"|"false"|"not_given", "evidence": "the shortest passage phrase that decides it, copied exactly, max 12 words; empty if not_given"}).
- true: the passage states it or it follows directly from what the passage says (paraphrase is fine).
- false: the passage says something that contradicts it — a changed detail, the opposite, a different person or thing, a wrong number, or an overstatement (only / always / all / never).
- not_given: the passage says nothing about it either way.
Judge only by the passage, never by general knowledge."""

REWRITE_SYS = """You rewrite ONE answer option of a Korean CSAT 「{name}」 question.
Output ONLY one JSON object. No markdown.
Keys: option (one English sentence, 8-20 words).
{goal}
Base it on [Target part] of the passage. Paraphrase — do not copy a passage sentence word for word.
It must be about something different from the other options listed."""

GOAL = {
    True: "The new option must be TRUE according to the passage: stated there or directly implied.",
    False: ("The new option must be clearly FALSE according to the passage: change ONE key detail of the target part "
            "(the opposite, a different person or thing, a wrong number, or an overstatement with only/always/never). "
            "It must contradict the passage — never write something the passage simply does not mention."),
}

EXPLAIN_SYS = """당신은 한국 수능 영어 「내용 일치/불일치」 문항의 한국어 해설만 씁니다.
출력은 JSON 한 개: {"Explanation": "..."} — 마크다운 금지.
- 첫 문장은 「정답은 ①.」 꼴로 정답 번호를 밝힌다.
- 정답 선지가 지문의 어느 부분과 맞는지(또는 어긋나는지) 지문 표현을 짧게 인용해 근거를 든다.
- 나머지 선지 중 두세 개도 근거를 한 줄씩 든다.
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


def _valid_option(s: str) -> bool:
    n = len(s.split())
    return 6 <= n <= 25 and not _has_hangul(s)


def _sentences(passage: str) -> list[str]:
    return [x.strip() for x in re.split(r"(?<=[.!?])\s+(?=[A-Z\"'(])", passage) if x.strip()]


def _parts(passage: str, n: int = 5) -> list[str]:
    """지문을 문장 단위로 n 덩이로 — k 번 선지를 다시 쓸 때 k 번째 덩이를 바탕으로 준다(지문 순서 유지)."""
    sents = _sentences(passage)
    if len(sents) < n:
        return [passage] * n
    size = len(sents) / n
    return [" ".join(sents[int(i * size): int((i + 1) * size)]) for i in range(n)]


def _evidence_pos(passage: str, evidence: str) -> int:
    """근거 구절이 지문 어디에 있는지(문자 위치). 못 찾으면 -1 — 앞 4단어로 한 번 더 찾는다."""
    low = passage.lower()
    ev = " ".join(evidence.lower().split()).strip(" .\"'")
    if not ev:
        return -1
    k = low.find(ev)
    if k < 0:
        head = " ".join(ev.split()[:4])
        k = low.find(head) if len(head) > 8 else -1
    return k


def _part_order(i: int, passage: str, parts: list[str], checks: list[dict] | None, skip: int) -> list[int]:
    """다시 쓸 때 줄 덩이 차례 — 다른 선지의 근거가 들어 있는 덩이는 뒤로, i 에 가까운 덩이부터."""
    used: set[int] = set()
    bounds, pos = [], 0
    for part in parts:
        start = passage.find(part[:40], pos) if part else -1
        bounds.append(start if start >= 0 else pos)
        pos = max(pos, bounds[-1])
    for j, c in enumerate(checks or []):
        if j == skip:
            continue
        at = _evidence_pos(passage, c.get("evidence", ""))
        if at >= 0:
            used.add(max(k for k, b in enumerate(bounds) if b <= at) if any(b <= at for b in bounds) else 0)
    order = sorted(range(len(parts)), key=lambda k: (k in used, abs(k - i)))
    return order


def _verdicts(obj: dict | None) -> list[dict] | None:
    rows = obj.get("checks") if isinstance(obj, dict) else None
    if not isinstance(rows, list) or len(rows) < 5:
        return None
    out = []
    for row in rows[:5]:
        if not isinstance(row, dict):
            return None
        v = str(row.get("verdict") or "").strip().lower().replace(" ", "_")
        if v not in ("true", "false", "not_given"):
            return None
        out.append({"verdict": v, "evidence": str(row.get("evidence") or "").strip()})
    return out


def _problems(kind: str, checks: list[dict], answer: int) -> dict[int, bool]:
    """역할과 판정이 어긋난 선지 → {위치: 되어야 할 참/거짓}."""
    bad: dict[int, bool] = {}
    for i, c in enumerate(checks):
        v = c["verdict"]
        want_true = (i == answer) if kind == "일치" else (i != answer)
        if want_true and v != "true":
            bad[i] = True
        elif not want_true and v != "false":  # 언급 없음도 다시 쓴다 — 「지문에 없으니 틀림」은 시비가 난다
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
    kind: str = "일치",
) -> dict[str, Any]:
    if kind not in KINDS:
        return {"ok": False, "error": f"unknown kind {kind!r} (일치|불일치)"}
    trace: list[dict[str, Any]] = []
    started = time.time()  # 문항 하나의 시간 한도 — 빈칸에서 다시 쓰기 반복으로 한 문항이 20분 걸린 일이 있었다
    if main_adapter:
        set_adapter(model, main_adapter)
    raw_out = [""]

    def call(sys_p: str, user: str, max_tokens: int = 400, *, adapter: bool = False, t: float | None = None) -> dict | None:
        raw_out[0] = chat_text(model, tokenizer, sys_p, user, max_tokens=max_tokens,
                               temp=temp if t is None else t, use_adapter=adapter)
        return extract_json_object(raw_out[0])

    # 1) 초안 — 학습한 그대로의 입력으로 LoRA. 모양이 깨지면 한 번 더, 그래도 안 되면 35B 가 같은 지시문으로
    options: list[str] = []
    answer = -1
    for d_try, use_lora in enumerate((True, True, False)):
        draft = call(SYSTEM_PROMPT, user_message(kind, passage), max_tokens=900, adapter=use_lora)
        opts = [o for o in _normalize_options((draft or {}).get("Options")) if o]
        ans = str((draft or {}).get("CorrectAnswer") or "").strip()[:1]
        trace.append({"stage": "draft", "lora": use_lora, "ok": len(opts) == 5 and ans in CIRCLED})
        if len(opts) == 5 and ans in CIRCLED:
            options, answer = opts, CIRCLED.index(ans)
            break
        print(f"[pipeline] draft try={d_try} unusable (options={len(opts)} answer={ans!r})", file=sys.stderr)
    if len(options) != 5:
        return {"ok": False, "error": "draft stage failed", "trace": trace}
    print(f"[pipeline] draft answer={CIRCLED[answer]}", file=sys.stderr)

    parts = _parts(passage)
    name = "내용 일치" if kind == "일치" else "내용 불일치"
    checks: list[dict] | None = None
    moved_note = ""
    remaining: dict[int, bool] = {}
    rejected: dict[int, list[str]] = {}  # 선지 자리별로 거절된 다시 쓰기 — 되풀이를 막으려고 다음 시도에 보여 준다

    # 2~3) 사실 확인 → 정답 번호 맞추기 → 어긋난 선지만 다시 쓰기
    for c_try in range(max_retries + 2):
        if time.time() - started > TIME_BUDGET_SEC:
            print(f"[pipeline] time budget {TIME_BUDGET_SEC}s reached — stop rewriting", file=sys.stderr)
            break
        checks = _verdicts(call(
            CHECK_SYS,
            f"[Passage]\n{passage}\n\n[Options]\n" + "\n".join(f"{k + 1}. {o}" for k, o in enumerate(options))
            + "\n\nReturn checks JSON.",
            max_tokens=600, t=0.0,
        ))
        trace.append({"stage": "check", "out": checks})
        if checks is None:
            print("[pipeline] check unreadable", file=sys.stderr)
            continue
        # 같은 선지도 놓인 순서에 따라 판정이 달라졌다(재확인에서 걸린 일치형의 절반 — 오답이 사실은 참).
        # 순서를 뒤집어 한 번 더 묻고, 두 판정 중 하나라도 규칙에 어긋나면 고친다(정답이 둘인 문항을 막는 쪽으로).
        rev = _verdicts(call(
            CHECK_SYS,
            f"[Passage]\n{passage}\n\n[Options]\n" + "\n".join(f"{k + 1}. {o}" for k, o in enumerate(options[::-1]))
            + "\n\nReturn checks JSON.",
            max_tokens=600, t=0.0,
        ))
        checks_rev = rev[::-1] if rev else None
        trace.append({"stage": "check_reversed", "out": checks_rev})
        print(f"[pipeline] check: {' '.join(c['verdict'][0].upper() for c in checks)}"
              + (f" / reversed: {' '.join(c['verdict'][0].upper() for c in checks_rev)}" if checks_rev else "")
              + f" answer={CIRCLED[answer]}", file=sys.stderr)
        # 정답이 될 수 있는 선지(일치=참, 불일치=거짓)가 딱 하나인데 번호만 다르면 번호를 옮긴다 — 두 판정이 같을 때만
        key = "true" if kind == "일치" else "false"
        cands = [i for i, c in enumerate(checks) if c["verdict"] == key]
        cands_rev = [i for i, c in enumerate(checks_rev) if c["verdict"] == key] if checks_rev else cands
        if len(cands) == 1 and cands == cands_rev and cands[0] != answer:
            moved_note = f"초안 정답 {CIRCLED[answer]} → 사실 확인상 {CIRCLED[cands[0]]}"
            print(f"[pipeline] answer re-pointed {CIRCLED[answer]} -> {CIRCLED[cands[0]]}", file=sys.stderr)
            answer = cands[0]
        bad = _problems(kind, checks, answer)
        if checks_rev:
            for i, want in _problems(kind, checks_rev, answer).items():
                bad.setdefault(i, want)
        # 선지끼리 거의 같은 말이면 뒤의 것을 다시 쓴다(오답 품질 14과와 같은 기준)
        for i in range(5):
            for j in range(i):
                if i not in bad and word_overlap(options[i], options[j]) >= NEAR_DUP:
                    bad[i] = (kind == "일치") == (i == answer)
        remaining = bad
        if not bad:
            break
        if c_try >= max_retries + 1:
            break
        for i, want_true in sorted(bad.items()):
            others = [o for k, o in enumerate(options) if k != i]
            # 다른 선지가 아직 안 다룬 덩이부터 — k 번째 덩이만 주면 이미 있는 선지와 같은 사실을 비틀게 된다
            # (31번: 끝 두 덩이가 「샐러드 유행」 한 사실뿐이라 ③·④·⑤가 모두 그 얘기). 순서는 4) 에서 다시 맞춘다
            for attempt, part_k in enumerate(_part_order(i, passage, parts, checks, skip=i)[: 3 if c_try == 0 else 1]):
                if time.time() - started > TIME_BUDGET_SEC:
                    break
                # 거절된 시도를 같이 보여 주고, 두 번째부터는 온도를 올린다 — 35B 가 같은 문장을 되풀이해
                # 덩이를 바꿔 줘도 같은 이유로 또 거절됐다(재확인 실패 일치형의 대부분, 거절 36건)
                tried = rejected.get(i, [])
                rew = call(
                    REWRITE_SYS.format(name=name, goal=GOAL[want_true]),
                    f"[Passage]\n{passage}\n\n[Target part]\n{parts[part_k]}\n\n[Other options — pick a different detail]\n"
                    + "\n".join(f"- {o}" for o in others)
                    + (("\n\n[Already rejected — too close to another option; write about a DIFFERENT detail]\n"
                        + "\n".join(f"- {x}" for x in tried[-3:])) if tried else "")
                    + f"\n\n[Option to replace]\n{options[i]}\n\nReturn option JSON.",
                    max_tokens=120,
                    t=temp if attempt == 0 and not tried else 0.8,
                )
                new = _strip_circled(str((rew or {}).get("option") or ""))
                ok = bool(new) and _valid_option(new) and all(word_overlap(new, o) < NEAR_DUP for o in others)
                trace.append({"stage": "rewrite", "i": i, "part": part_k, "want_true": want_true, "out": new, "ok": ok})
                if ok:
                    options[i] = new
                    break
                if new:
                    rejected.setdefault(i, []).append(new)
                print(f"[pipeline] rewrite {CIRCLED[i]} rejected (part {part_k}): {new[:70]}", file=sys.stderr)

    warnings: list[str] = []
    if checks is None:
        warnings.append("사실 확인을 읽지 못했습니다 — 선지가 지문과 맞는지 직접 확인 필요")
    for i, want_true in sorted(remaining.items()):
        warnings.append(
            f"선지 {CIRCLED[i]} 확인 필요 — {'지문과 맞아야' if want_true else '지문과 어긋나야'} 하는데 사실 확인에서 "
            f"{(checks or [{}] * 5)[i].get('verdict', '?')}"
        )
    if moved_note:
        warnings.append(f"{moved_note} — 정답 번호를 사실 확인에 맞춰 옮겼습니다")

    # 4) 지문 순서 — 근거 구절 위치가 다 잡히면 그 순서로 다시 놓는다(수능 내용일치 선지는 지문 차례를 따른다)
    if checks is not None and not remaining:
        pos = [_evidence_pos(passage, c["evidence"]) for c in checks]
        if all(p >= 0 for p in pos) and pos != sorted(pos):
            order = sorted(range(5), key=lambda k: pos[k])
            options = [options[k] for k in order]
            checks = [checks[k] for k in order]
            answer = order.index(answer)
            print(f"[pipeline] reordered to passage order {order}", file=sys.stderr)

    # 5) 모의 풀이 — 경고만
    warnings += solve_check(call, kind="match" if kind == "일치" else "mismatch", passage=passage,
                            options_text=_format_options(options), answer=CIRCLED[answer], trace=trace)

    # 6) 해설 — 사실 확인 근거를 같이 준다
    ev_lines = "\n".join(
        f"{CIRCLED[k]} {c['verdict']}: {c['evidence']}" for k, c in enumerate(checks or [])
    )
    expl = call(
        EXPLAIN_SYS,
        f"[지문]\n{passage}\n\n[문제]\n{QUESTION[kind]}\n\n[선지]\n{_format_options(options)}\n\n"
        f"[정답]\n{CIRCLED[answer]}\n\n[사실 확인 근거]\n{ev_lines}\n\nExplanation JSON 만 출력.",
        max_tokens=500,
    )
    explanation = trim_to_sentence(explanation_text(expl, raw_out[0], CIRCLED[answer]), 450)
    if len(explanation) < 40:
        c = (checks or [{}] * 5)[answer]
        explanation = (f"정답은 {CIRCLED[answer]}. 지문의 「{c.get('evidence', '')}」 부분과 "
                       f"{'일치한다' if kind == '일치' else '어긋난다'}.")[:450]

    qd = {
        "Question": QUESTION[kind],
        "Paragraph": passage,
        "Options": _format_options(options),
        "CorrectAnswer": CIRCLED[answer],
        "Explanation": explanation,
        "OptionType": "English",
    }
    errs = [f"option {k + 1} shape" for k, o in enumerate(options) if not _valid_option(o)]
    if errs:
        warnings.append("선지 모양 확인 필요: " + ", ".join(errs))
    return {
        "ok": True,
        "question_data": qd,
        "warnings": warnings,
        "pipeline": {"kind": kind, "answer_moved": bool(moved_note), "unresolved": len(remaining),
                     "trace_len": len(trace)},
        "trace": trace,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="내용 일치·불일치 파이프라인 단독 실행")
    ap.add_argument("--kind", default="일치", choices=KINDS)
    ap.add_argument("--passage-file", required=True)
    ap.add_argument("--adapter", default=str(DEFAULT_ADAPTER))
    ap.add_argument("--model", default="")
    args = ap.parse_args()
    passage = Path(args.passage_file).read_text(encoding="utf-8").strip()
    adapter = Path(args.adapter)
    model_name = args.model or load_base_model_name(adapter, DEFAULT_MODEL)
    model, tok, _ = load_model(model_name, adapter if adapter_exists(adapter) else None, resolve_use_4bit(adapter, False))
    res = run_pipeline(model, tok, passage, kind=args.kind)
    res.pop("trace", None)
    print(json.dumps(res, ensure_ascii=False, indent=1))
    return 0 if res.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
