"""순서·삽입 파이프라인 공용 — 규칙 생성(rule_gen) → 35B 모의 풀이로 거르기 → 해설.

LoRA 가 없다. 규칙으로 여러 시드를 만들어 보고, 35B 가 정답을 모르는 채로 풀었을 때
「정답을 맞히고 다른 답도 된다고 하지 않는」 문항만 쓴다 — 무작위로 자르면 순서가 여럿 되거나
주어진 문장이 두 곳에 다 들어가는 문항이 나오기 때문이다(학습실 생성기의 단서 우선 규칙만으로는 못 막는다).
워커(inference_child)는 어댑터 없는 이 유형도 같은 run_pipeline 약속으로 부른다 — main_adapter 는 무시한다.
"""
from __future__ import annotations

import random
import sys
import time
from typing import Any

from json_extract import explanation_text, extract_json_object, trim_to_sentence
from rule_gen import CIRCLED, ORDER_OPTIONS, generate_insert, generate_order, split_sentences

QUESTION = {
    "order": "주어진 글 다음에 이어질 글의 순서로 가장 적절한 것을 고르시오.",
    "insert": "글의 흐름으로 보아, 주어진 문장이 들어가기에 가장 적절한 곳을 고르시오.",
}
MAX_SEEDS = 8
TIME_BUDGET_SEC = 120
MIN_GIVEN_WORDS = 6  # 「Both figuratively and literally.」 같은 조각 문장은 주어진 문장으로 쓰지 않는다

SOLVE_SYS = {
    "order": """You are a top Korean high-school student solving a CSAT sentence-order question. You are NOT given the answer.
Read the given text, then the three parts (A), (B), (C), and decide the order in which they follow the given text.
Use the linking clues: pronouns (this, they, such), connectives (however, for example, as a result), and repeated or newly introduced ideas.
Output ONLY one JSON object. No markdown.
Keys: answer (one of ①②③④⑤ — the best option), also_defensible (array of other circled numbers that a careful student could ALSO defend; [] if none), reason (short English).""",
    "insert": """You are a top Korean high-school student solving a CSAT sentence-insertion question. You are NOT given the answer.
Decide where the given sentence fits best among the marked places ①–⑤ in the passage.
Use the linking clues: pronouns (this, they, such), connectives (however, for example, as a result), and the logical gap the sentence fills.
Output ONLY one JSON object. No markdown.
Keys: answer (one of ①②③④⑤ — the best place), also_defensible (array of other circled numbers that a careful student could ALSO defend; [] if none), reason (short English).""",
}

EXPLAIN_SYS = {
    "order": """당신은 한국 수능 영어 「글의 순서」 문항의 한국어 해설만 씁니다.
출력은 JSON 한 개: {"Explanation": "..."} — 마크다운 금지.
- 첫 문장은 「⑤가 정답입니다.」 꼴로 정답 번호를 밝힌다.
- 주어진 글 다음에 어느 덩이가 오는지, 그다음은 무엇인지 차례로, 연결 단서(대명사·연결어·앞 내용을 받는 말)를 짧게 인용해 근거를 든다.
- 마지막에 「따라서 (C)-(B)-(A)의 순서가 알맞다」처럼 순서를 정리한다.
- 450자 이하, 한국어로만 쓴다(영어 인용은 짧게).""",
    "insert": """당신은 한국 수능 영어 「문장 삽입」 문항의 한국어 해설만 씁니다.
출력은 JSON 한 개: {"Explanation": "..."} — 마크다운 금지.
- 첫 문장은 「②가 정답입니다.」 꼴로 정답 번호를 밝힌다.
- 주어진 문장이 앞 문장의 무엇을 받는지, 뒤 문장이 주어진 문장의 무엇을 받는지 연결 단서를 짧게 인용해 근거를 든다.
- 450자 이하, 한국어로만 쓴다(영어 인용은 짧게).""",
}


# 원문자 번호를 읽는 소리에 맞춘 조사 — ①(일)이 ②(이)가 ③(삼)이 ④(사)가 ⑤(오)가. 35B 는 늘 「가」를 붙였다
_SUBJ = {"①": "이", "②": "가", "③": "이", "④": "가", "⑤": "가"}


def fix_particles(text: str) -> str:
    import re as _re

    return _re.sub(r"([①②③④⑤])(이|가)(?=\s|$|[.,])", lambda m: m.group(1) + _SUBJ[m.group(1)], text)


def _order_paragraph(q: dict) -> str:
    return f"{q['intro']}\n\n(A) {q['A']}\n\n(B) {q['B']}\n\n(C) {q['C']}"


def _insert_paragraph(q: dict) -> str:
    return f"{q['given']}\n\n{q['body']}"


def _options(kind: str) -> str:
    # 순서는 줄바꿈 5줄이 표준(관리자 순서 보기 검증이 \n 으로만 나눈다), 삽입은 번호만
    if kind == "order":
        return "\n".join(f"{CIRCLED[i]} {o}" for i, o in enumerate(ORDER_OPTIONS))
    return "\n".join(CIRCLED)


def _solve_text(kind: str, q: dict) -> str:
    if kind == "order":
        opts = "\n".join(f"{CIRCLED[i]} {o}" for i, o in enumerate(ORDER_OPTIONS))
        return f"[Given text]\n{q['intro']}\n\n(A) {q['A']}\n\n(B) {q['B']}\n\n(C) {q['C']}\n\n[Options]\n{opts}\n\nReturn JSON."
    return f"[Given sentence]\n{q['given']}\n\n[Passage]\n{q['body']}\n\nReturn JSON."


def run(kind: str, chat_text, model: Any, tokenizer: Any, passage: str, *, temp: float = 0.3) -> dict[str, Any]:
    trace: list[dict[str, Any]] = []
    raw_out = [""]

    def call(sys_p: str, user: str, max_tokens: int = 400, t: float | None = None) -> dict | None:
        raw_out[0] = chat_text(model, tokenizer, sys_p, user, max_tokens=max_tokens,
                               temp=temp if t is None else t, use_adapter=False)
        return extract_json_object(raw_out[0])

    sentences = split_sentences(passage)
    need = 5 if kind == "order" else 6
    if len(sentences) < need:
        return {"ok": False, "error": f"지문이 짧아 {'순서' if kind == 'order' else '삽입'} 문항을 만들 수 없습니다(문장 {len(sentences)}개, {need}개 이상 필요)"}

    started = time.time()
    base_seed = random.randrange(2 ** 31)
    chosen = fallback = None
    tried = 0
    for k in range(MAX_SEEDS):
        if time.time() - started > TIME_BUDGET_SEC:
            break
        q = (generate_order if kind == "order" else generate_insert)(sentences, base_seed + k)
        if q is None:
            continue
        if kind == "insert" and len(q["given"].split()) < MIN_GIVEN_WORDS:
            continue
        tried += 1
        got = call(SOLVE_SYS[kind], _solve_text(kind, q), max_tokens=250, t=0.0)
        picked = str((got or {}).get("answer") or "").strip()[:1]
        others = {str(x).strip()[:1] for x in ((got or {}).get("also_defensible") or []) if isinstance(x, (str, int))}
        key = CIRCLED[q["answer"]]
        others.discard(key)
        trace.append({"stage": "solve", "seed": base_seed + k, "key": key, "picked": picked, "also": sorted(others)})
        print(f"[pipeline] seed {k}: key={key} solver={picked or '?'} also={''.join(sorted(others)) or '-'}", file=sys.stderr)
        if picked == key and not (others & set(CIRCLED)):
            chosen = q
            break
        if picked == key and fallback is None:
            fallback = (q, sorted(others & set(CIRCLED)))
    warnings: list[str] = []
    if chosen is None and fallback is not None:
        chosen, alts = fallback
        warnings.append(f"모의 풀이(35B)가 {'·'.join(alts)}도 답이 될 수 있다고 봤습니다 — 확인 필요")
    if chosen is None:
        return {"ok": False, "error": f"풀 만한 문항을 만들지 못했습니다(시드 {tried}개 모두 모의 풀이 실패) — 다시 생성해 주세요",
                "trace": trace}

    answer = CIRCLED[chosen["answer"]]
    paragraph = _order_paragraph(chosen) if kind == "order" else _insert_paragraph(chosen)
    if kind == "order":
        hint = "원래 순서: " + " → ".join(chosen["ordered"])
        order_label = ORDER_OPTIONS[chosen["answer"]]
        ctx = f"[주어진 글과 (A)(B)(C)]\n{paragraph}\n\n[정답]\n{answer} {order_label}\n\n[{hint[:1500]}]"
    else:
        ctx = (f"[문제]\n{paragraph}\n\n[정답]\n{answer}\n\n[원래 자리]\n앞 문장: {chosen['before']}\n"
               f"주어진 문장: {chosen['given']}\n뒤 문장: {chosen['after']}")
    expl = call(EXPLAIN_SYS[kind], f"{ctx}\n\nExplanation JSON 만 출력.", max_tokens=500)
    explanation = fix_particles(trim_to_sentence(explanation_text(expl, raw_out[0], answer), 450))
    if len(explanation) < 40:
        explanation = (f"{answer}{_SUBJ[answer]} 정답입니다. " + (f"주어진 글 다음에 {ORDER_OPTIONS[chosen['answer']]}의 순서로 이어진다."
                       if kind == "order" else f"주어진 문장은 「{chosen['before'][:60]}」 뒤에 들어가 앞뒤 문장을 잇는다."))[:450]

    return {
        "ok": True,
        "question_data": {
            "Question": QUESTION[kind],
            "Paragraph": paragraph,
            "Options": _options(kind),
            "CorrectAnswer": answer,
            "Explanation": explanation,
            "OptionType": "English",
        },
        "warnings": warnings,
        "pipeline": {"kind": kind, "seeds_tried": tried, "sentences": len(sentences)},
        "trace": trace,
    }
