"""무관한문장·어휘·어법 파이프라인 공용 — 원문을 조금 고쳐 만드는 유형(LoRA 없음).

순서·삽입(rule_pipeline)과 같은 틀이다. 자리와 정답 번호는 코드가 정하고, 35B 는 바꿀 것 하나만 쓴다
(엉뚱한 문장 하나 · 반대말 하나 · 틀린 어법 형태 하나). 그다음 35B 가 정답을 모르고 풀어 「정답을 맞히고
다른 답도 된다고 하지 않는」 것만 쓴다 — 오답 자리 네 곳은 원문 그대로라 틀릴 수 없고, 흔들리는 건 바꾼 하나뿐이다.

  무관한문장(irrelevant): 연속 4문장 사이에 새로 쓴 문장 하나를 끼우고 다섯 문장에 ①~⑤
  어휘(vocab)          : 낱말 다섯에 ①~⑤, 하나를 문맥과 반대되는 말로
  어법(grammar)        : 구절 다섯에 ①<u>…</u>, 하나를 어법상 틀린 형태로
"""
from __future__ import annotations

import random
import re
import sys
import time
from typing import Any

from json_extract import explanation_text, extract_json_object, trim_to_sentence
from rule_gen import CIRCLED, split_sentences
from rule_pipeline import _SUBJ, fix_particles

QUESTION = {
    "irrelevant": "다음 글에서 전체 흐름과 관계없는 문장은?",
    "vocab": "다음 글의 밑줄 친 부분 중, 문맥상 낱말의 쓰임이 적절하지 않은 것은?",
    "grammar": "다음 글의 밑줄 친 부분 중, 어법상 틀린 것은?",
}
MAX_TRIES = 10  # 한 번 만들고 풀어 보는 데 3~5초 — 시간 한도(150초) 안에서 넉넉히
TIME_BUDGET_SEC = 150

WRITE_IRR_SYS = """You write ONE sentence for a Korean CSAT 「irrelevant sentence」 question.
Output ONLY one JSON object. No markdown.
Keys: sentence (one English sentence, 12-25 words).
The sentence will be placed between [Before] and [After] in the passage. Real CSAT distractor sentences are SUBTLE:
- Reuse at least two key words of the passage (its main nouns), so that it looks like it belongs.
- Say something true-sounding about the same topic, but from an angle the passage is NOT arguing at that point
  (e.g. the passage says X matters more than Y → the sentence praises a benefit of Y, or describes how people
  commonly feel about the topic, or shifts from the passage's main actor to another one).
- Do not begin with "Many …", "Some people …" or "Most people …" — vary the subject (use the passage's own key noun).
- NEVER use history or trivia (no dates, centuries, "ancient", "dates back", "origins"), no numbers, no names.
- Removing it must leave the passage flowing naturally. Do not start it with a connective (However, For example, This …),
  do not contradict the passage in an obvious way, and do not copy a passage sentence."""

IRR_CHECK_SYS = """You check the inserted sentence of a Korean CSAT 「irrelevant sentence」 question.
Output ONLY one JSON object. No markdown.
Keys: fits (true if [Sentence] placed between [Before] and [After] continues, supports, or restates the passage's point there,
so that a careful reader could accept it as part of the passage; false if it clearly drifts away from the line of argument), reason (short English)."""

PICK_VOCAB_SYS = """You build a Korean CSAT 「vocabulary in context」 question.
Output ONLY one JSON object. No markdown.
Keys: words (array of exactly 5 DIFFERENT single words copied EXACTLY from the passage, in the order they appear, spread over the beginning, middle and end).
- Choose content words (verbs, adjectives, nouns, adverbs) that carry the passage's logic, so that replacing any of them
  with its opposite would clearly break the meaning.
- Do not choose names, numbers, function words, or words inside quotation marks."""

FLIP_SYS = """You make the ONE wrong word of a Korean CSAT 「vocabulary in context」 question.
Output ONLY one JSON object. No markdown.
Keys: wrong (one English word), reason (short English).
Replace [Word] in [Sentence] with a word that:
- has the SAME part of speech and the SAME form (noun stays noun, -ed stays -ed, -ing stays -ing, plural stays plural),
- keeps [Sentence] perfectly grammatical with the words around it (articles, prepositions after it: "warn against" needs a verb that takes "against"),
- makes the sentence say the OPPOSITE of what the passage needs (an antonym or a word pointing the other way), so a careful reader sees it is wrong.
Not a synonym, not a vaguer word, not a word that is merely odd."""

PICK_GRAMMAR_SYS = """You build a Korean CSAT 「grammar」 question.
Output ONLY one JSON object. No markdown.
Keys: spans (array of exactly 5 DIFFERENT short spans of 1-3 words (1-2 is best) copied EXACTLY from the passage, in the order they appear, spread over the beginning, middle and end).
- Each span must test a real grammar point: verb form/tense/agreement, participle (-ing/-ed), to-infinitive vs gerund, relative pronoun
  (which/who/that/what/where), active vs passive, adjective vs adverb, parallel structure, pronoun agreement.
- Underline ONLY the grammar-bearing word(s): e.g. "which", "to design", "is", "rapidly", "them", "where", "having been".
  Never underline a plain noun phrase or name (NOT "ancient Greek", "existing objects", "put air around").
- The four correct spans should be places where a student might hesitate (e.g. a correct "what", a correct passive, a correct -ing),
  so the question is not solved by spotting one odd word.
- Do not choose names, numbers, or spans inside quotation marks."""

VOCAB_CHECK_SYS = """You check the wrong word of a Korean CSAT 「vocabulary in context」 question.
Output ONLY one JSON object. No markdown.
Keys: grammatical (true if [Changed sentence] is still grammatical — same part of speech and form, ignore meaning),
makes_sense (true if [Changed sentence] could still be accepted in the passage's context, i.e. it is NOT clearly wrong), reason (short English).
A good wrong word keeps the sentence grammatical but makes it say the opposite of what the passage needs."""

CORRUPT_SYS = """You make the ONE wrong option of a Korean CSAT 「grammar」 question.
Output ONLY one JSON object. No markdown.
Keys: wrong (the replacement for [Span]), point (short English name of the grammar point).
Replace [Span] with a form that is clearly UNGRAMMATICAL in [Sentence] — a typical CSAT trap for that grammar point:
verb agreement (is ↔ are), tense/form (worked ↔ working), to-infinitive ↔ gerund, active ↔ passive, relative pronoun
(which ↔ what, where ↔ which), adjective ↔ adverb, pronoun number (it ↔ them).
Change only the grammar-bearing word; keep the meaning words the same (to work → working is fine, to work → to play is not).
The result must be wrong, not just a different correct choice."""

GRAMMAR_CHECK_SYS = """You are a strict English grammar checker.
Output ONLY one JSON object. No markdown.
Keys: grammatical (true if [Sentence] is grammatically correct standard English; false if it has a grammar error), error (short English, or "")."""

SOLVE_SYS = {
    "irrelevant": "a CSAT question asking which numbered sentence does NOT fit the passage's overall flow",
    "vocab": "a CSAT question asking which numbered word is NOT appropriate in context",
    "grammar": "a CSAT question asking which underlined part is grammatically WRONG",
}
SOLVE_TMPL = """You are a top Korean high-school student solving {what}. You are NOT given the answer.
Output ONLY one JSON object. No markdown.
Keys: answer (one of ①②③④⑤), also_defensible (array of other circled numbers a careful student could ALSO pick; [] if none), reason (short English)."""

EXPLAIN_SYS = {
    "irrelevant": """당신은 한국 수능 영어 「무관한 문장」 문항의 한국어 해설만 씁니다.
출력은 JSON 한 개: {"Explanation": "..."} — 마크다운 금지.
- 첫 문장은 「⑤가 정답입니다.」 꼴로 정답 번호를 밝힌다.
- 글 전체가 무엇에 관한 흐름인지 한 문장으로 말하고, 정답 문장이 왜 그 흐름에서 벗어나는지 짧게 인용해 설명한다.
- 정답 문장을 빼면 앞뒤가 어떻게 자연스럽게 이어지는지 덧붙인다. 450자 이하, 한국어로만(영어 인용은 짧게).""",
    "vocab": """당신은 한국 수능 영어 「문맥상 어휘」 문항의 한국어 해설만 씁니다.
출력은 JSON 한 개: {"Explanation": "..."} — 마크다운 금지.
- 첫 문장은 「②가 정답입니다.」 꼴로 정답 번호를 밝힌다.
- 문맥 근거(앞뒤 표현을 짧게 인용)를 들어, 정답 낱말을 무엇으로 고쳐야 하는지(원래 낱말) 밝힌다.
- 450자 이하, 한국어로만(영어 인용은 짧게).""",
    "grammar": """당신은 한국 수능 영어 「어법」 문항의 한국어 해설만 씁니다.
출력은 JSON 한 개: {"Explanation": "..."} — 마크다운 금지.
- 첫 문장은 「④가 정답입니다.」 꼴로 정답 번호를 밝힌다.
- 정답 부분이 왜 틀렸는지 어법 근거를 들고, 무엇으로 고쳐야 하는지(원래 형태) 밝힌다.
- 나머지 네 곳이 왜 맞는지 한 줄씩 짧게 든다. 450자 이하, 한국어로만(영어 인용은 짧게).""",
}


_TRIVIA = re.compile(r"\b(history|historical|histor\w*|ancient|centur\w*|dates? back|origins?|\d{3,4}s?)\b", re.I)
_WORD = re.compile(r"[A-Za-z]+")


_STOP = {"that", "this", "these", "those", "with", "they", "their", "them", "have", "from", "which", "what", "when",
         "been", "more", "than", "also", "into", "some", "such", "very", "many", "most", "other", "about", "there",
         "would", "could", "should", "while", "where", "because", "often", "only", "even", "just", "make", "makes"}


def _key_overlap(sentence: str, passage: str) -> int:
    """지문의 내용어를 몇 개 다시 쓰나 — 무관한 문장이 한눈에 튀지 않게. plan·plans·planning 은 같은 말로(앞 4글자)."""
    def stems(t: str) -> set[str]:
        return {w.lower()[:4] for w in _WORD.findall(t) if len(w) >= 4 and w.lower() not in _STOP}
    return len(stems(sentence) & stems(passage))


def _suffix(w: str) -> str:
    """-ing·-ed·-ly·-s 꼴 — 바꾼 낱말이 원래 낱말과 같은 꼴이어야 비문이 안 된다."""
    w = w.lower()
    for suf in ("ing", "ed", "ly"):
        if w.endswith(suf) and len(w) > len(suf) + 2:
            return suf
    return "s" if len(w) > 3 and w.endswith("s") and not w.endswith(("ss", "us", "is")) else ""


def _overlap(a: str, b: str) -> float:
    """두 문장의 낱말 겹침 — 짧은 쪽 기준."""
    wa, wb = ({w.lower() for w in _WORD.findall(t)} for t in (a, b))
    return len(wa & wb) / max(1, min(len(wa), len(wb)))


_PARTICLE = {"against", "up", "off", "out", "from", "into", "with", "to", "on", "for", "about", "down", "away", "over"}


def _clean(x) -> str:
    return " ".join(str(x or "").split()).strip(" .,;:!?\"“”")


_FUNC = {"which", "what", "that", "who", "whom", "whose", "where", "when", "how", "it", "them", "they", "its", "their",
         "is", "are", "was", "were", "be", "being", "been", "has", "have", "had", "do", "does", "did", "to"}


def _one_change(orig: str, wrong: str) -> bool:
    """틀린 꼴이 밑줄 한 곳만 바꿨나 — 같은 길이면 한 낱말 치환, 길이가 다르면 한 낱말 더함·뺌·합침(to work → working).
    바뀐 낱말은 원래 낱말과 어간이 같거나(work·worked) 둘 다 기능어(which·what, is·are)여야 한다."""
    a, b = orig.lower().split(), wrong.lower().split()
    if not b or a == b or len(b) > 3 or abs(len(a) - len(b)) > 1:
        return False
    if len(a) == len(b):
        d = [(x, y) for x, y in zip(a, b) if x != y]
        if len(d) != 1:
            return False
        x, y = d[0]
        return x[:3] == y[:3] or (x in _FUNC and y in _FUNC)
    return any(x[:3] == y[:3] for x in a for y in b) or bool(set(a) & _FUNC and set(b) & _FUNC)


def _locate_any(passage: str, spans: list[str]) -> list[tuple[int, int]] | None:
    """spans 를 순서와 상관없이(같은 말이 둘이면 다른 자리로) 찾아 위치순으로 돌려준다."""
    used: list[tuple[int, int]] = []
    for sp in spans:
        pat = re.compile(r"(?<![A-Za-z])" + r"\s+".join(re.escape(w) for w in sp.split()) + r"(?![A-Za-z]|['’][a-z])")
        hit = next((m.span() for m in pat.finditer(passage)
                    if all(m.end() <= u0 or m.start() >= u1 for u0, u1 in used)), None)
        if hit is None:
            return None
        used.append(hit)
    return sorted(used)


def _skip(trace: list, reason: str) -> None:
    trace.append({"stage": "skip", "reason": reason})
    print(f"[pipeline] skip: {reason}", file=sys.stderr)


def _spread_ok(locs: list[tuple[int, int]], total: int) -> bool:
    """다섯 곳이 한쪽에 몰리지 않았나 — 첫 곳과 마지막 곳이 지문 길이의 절반 이상 떨어져 있어야."""
    return locs[-1][0] - locs[0][0] >= total * 0.45


def run(kind: str, chat_text, model: Any, tokenizer: Any, passage: str, *, temp: float = 0.3) -> dict[str, Any]:
    trace: list[dict[str, Any]] = []
    raw_out = [""]

    def call(sys_p: str, user: str, max_tokens: int = 400, t: float | None = None) -> dict | None:
        raw_out[0] = chat_text(model, tokenizer, sys_p, user, max_tokens=max_tokens,
                               temp=temp if t is None else t, use_adapter=False)
        return extract_json_object(raw_out[0])

    sentences = split_sentences(passage)
    if kind == "irrelevant" and len(sentences) < 5:
        return {"ok": False, "error": f"지문이 짧아 무관한 문장 문항을 만들 수 없습니다(문장 {len(sentences)}개, 5개 이상 필요)"}

    started = time.time()
    rnd = random.Random()
    chosen: dict | None = None
    fallback: tuple[dict, list[str]] | None = None
    tried = 0
    for attempt in range(MAX_TRIES):
        if time.time() - started > TIME_BUDGET_SEC:
            break
        k = rnd.randrange(5)  # 정답 번호를 먼저 고르게 뽑는다
        cand = _make(kind, k, passage, sentences, call, rnd, trace)
        if cand is None:
            continue
        tried += 1
        got = call(SOLVE_TMPL.format(what=SOLVE_SYS[kind]),
                   f"[Question]\n{QUESTION[kind]}\n\n[Passage]\n{cand['paragraph']}\n\n"
                   + (f"[Options]\n{cand['options']}\n\n" if kind == "vocab" else "") + "Return JSON.",
                   max_tokens=250, t=0.0)
        picked = str((got or {}).get("answer") or "").strip()[:1]
        others = {str(x).strip()[:1] for x in ((got or {}).get("also_defensible") or []) if isinstance(x, (str, int))}
        key = CIRCLED[k]
        others = (others & set(CIRCLED)) - {key}
        trace.append({"stage": "solve", "key": key, "picked": picked, "also": sorted(others)})
        print(f"[pipeline] try {attempt}: key={key} solver={picked or '?'} also={''.join(sorted(others)) or '-'}",
              file=sys.stderr)
        if picked == key and not others:
            chosen = cand
            break
        if picked == key and fallback is None:
            fallback = (cand, sorted(others))

    warnings: list[str] = []
    if chosen is None and fallback is not None:
        chosen, alts = fallback
        warnings.append(f"모의 풀이(35B)가 {'·'.join(alts)}도 답이 될 수 있다고 봤습니다 — 확인 필요")
    if chosen is None:
        return {"ok": False, "error": f"풀 만한 문항을 만들지 못했습니다(시도 {tried}번 모두 모의 풀이 실패) — 다시 생성해 주세요",
                "trace": trace}

    answer = chosen["answer"]
    explanation = ""
    for t_ in (None, 0.0):  # 번호가 어긋나면(다른 번호를 정답이라 쓰면) 한 번 더 — 그래도 안 되면 근거 문구로
        expl = call(EXPLAIN_SYS[kind], f"[문제]\n{QUESTION[kind]}\n\n[지문]\n{chosen['paragraph']}\n\n"
                                       + (f"[선지]\n{chosen['options']}\n\n" if kind == "vocab" else "")
                                       + f"[정답]\n{answer}\n\n[정답 근거]\n{chosen['note']}\n\nExplanation JSON 만 출력.",
                    max_tokens=500, t=t_)
        explanation = fix_particles(trim_to_sentence(explanation_text(expl, raw_out[0], answer), 450))
        if len(explanation) >= 40:
            break
    if len(explanation) < 40:
        explanation = f"{answer}{_SUBJ[answer]} 정답입니다. {chosen['note']}"[:450]
    return {
        "ok": True,
        "question_data": {
            "Question": QUESTION[kind],
            "Paragraph": chosen["paragraph"],
            "Options": chosen["options"],
            "CorrectAnswer": answer,
            "Explanation": explanation,
            "OptionType": "English",
        },
        "warnings": warnings,
        "pipeline": {"kind": kind, "tries": tried},
        "trace": trace,
    }


def _make(kind: str, k: int, passage: str, sentences: list[str], call, rnd: random.Random,
          trace: list[dict[str, Any]]) -> dict | None:
    """정답 번호 k 로 문항 하나를 만든다. 못 만들면 None(다음 시도)."""
    if kind == "irrelevant":
        n = len(sentences)
        ws = rnd.randrange(1, n - 3)  # 앞에 도입 한 문장 이상, 원문 연속 4문장
        window = sentences[ws: ws + 4]
        before = window[k - 1] if k >= 1 else sentences[ws - 1]
        after = window[k] if k < 4 else (sentences[ws + 4] if ws + 4 < n else "")
        got = call(WRITE_IRR_SYS, f"[Passage]\n{passage}\n\n[Before]\n{before}\n\n[After]\n{after or '(end of passage)'}\n\n"
                                  "Return JSON.", max_tokens=160)
        irr = " ".join(str((got or {}).get("sentence") or "").split())
        trace.append({"stage": "write", "k": k, "sentence": irr})
        if not (10 <= len(irr.split()) <= 30):
            _skip(trace, f"문장 길이 — {irr[:80]}")
            return None
        # 원문 문장을 그대로(또는 거의 그대로) 쓰면 정답이 원문이 된다 — 36번에서 공백만 다른 원문이 끼워졌다
        if max((_overlap(irr, x) for x in sentences), default=0) >= 0.6:
            _skip(trace, f"원문 문장과 거의 같음 — {irr[:80]}")
            return None
        # 지문 자체가 옛이야기(고대 그리스 화가 등)면 그 낱말은 괜찮다 — 지문에 없는 역사·연도만 곁가지로 본다
        if any(m.group(0).lower() not in passage.lower() for m in _TRIVIA.finditer(irr)):
            _skip(trace, f"역사·연도 곁가지(너무 쉽다) — {irr[:80]}")
            return None
        if re.match(r"(Many|Some|Most)\b", irr):
            _skip(trace, f"「Many …」 시작(늘 같은 모양이라 티가 난다) — {irr[:80]}")
            return None
        if _key_overlap(irr, passage) < 2:
            _skip(trace, f"지문 핵심어를 다시 쓰지 않음(너무 튄다) — {irr[:80]}")
            return None
        chk = call(IRR_CHECK_SYS, f"[Passage]\n{passage}\n\n[Before]\n{before}\n\n[Sentence]\n{irr}\n\n[After]\n"
                                  f"{after or '(end of passage)'}\n\nReturn JSON.", max_tokens=160, t=0.0) or {}
        trace.append({"stage": "irr_check", "fits": chk.get("fits")})
        if chk.get("fits") is True:
            # 앞 문장을 그대로 잇거나 요지를 되풀이하면 무관하지 않다(29·30·37번) — 풀이는 「튀는 문장」으로 맞혀도 문항은 틀린다
            _skip(trace, f"흐름에 맞음(무관하지 않다) — {irr[:80]}")
            return None
        marked = window[:k] + [irr] + window[k:]
        body = " ".join(f"{CIRCLED[i]} {s}" for i, s in enumerate(marked))
        para = " ".join(sentences[:ws] + [body] + sentences[ws + 4:])
        return {"paragraph": para, "options": " ### ".join(CIRCLED), "answer": CIRCLED[k],
                "note": f"끼워 넣은 문장: {irr}"}

    if kind == "vocab":
        # 어휘도 두 번에 나눈다 — 한 번에 「k번째 낱말의 반대말」까지 시키면 품사·꼴이 어긋난 말이 잦았다
        # (a moment of ignore, Instead of stagnant). 낱말 다섯 → 위치순 → k번째 낱말과 그 문장을 주고 바꿀 말만
        got = call(PICK_VOCAB_SYS, f"[Passage]\n{passage}\n\nReturn JSON.", max_tokens=300)
        items = [_clean(x) for x in ((got or {}).get("words") or [])][:5]
        if len(items) != 5 or any(len(w.split()) != 1 for w in items):
            _skip(trace, f"낱말 다섯(한 낱말씩)이 아님 — {items}")
            return None
        found = _locate_any(passage, items)
        if found is None:
            _skip(trace, f"지문에서 못 찾음 — {items}")
            return None
        items = [passage[a:b] for a, b in found]
        nxt = re.match(r"\s*([A-Za-z]+)", passage[found[k][1]:])
        if nxt and nxt.group(1).lower() in _PARTICLE:
            # warn against · messed up · switched from — 뒤 전치사에 묶인 낱말을 바꾸면 구동사가 깨져 비문이 된다
            _skip(trace, f"전치사에 묶인 낱말 — {items[k]} {nxt.group(1)}")
            return None
        sent = next((x for x in split_sentences(passage) if re.search(rf"(?<![A-Za-z]){re.escape(items[k])}(?![A-Za-z])", x)), "")
        got2 = call(FLIP_SYS, f"[Passage]\n{passage}\n\n[Sentence]\n{sent}\n\n[Word]\n{items[k]}\n\nReturn JSON.",
                    max_tokens=160)
        wrong = _clean((got2 or {}).get("wrong"))
        trace.append({"stage": "pick", "k": k, "items": items, "wrong": wrong})
        if not wrong or len(wrong.split()) != 1 or wrong.lower() == items[k].lower():
            _skip(trace, f"바꾼 말이 한 낱말이 아님 — {items[k]} → {wrong}")
            return None
        if _suffix(items[k]) != _suffix(wrong):
            # blossoms → wither, moving → stagnant 처럼 꼴이 달라지면 어휘가 아니라 어법 오류가 된다
            _skip(trace, f"어휘 꼴 불일치 — {items[k]} → {wrong}")
            return None
        a0 = found[k][0]
        if re.search(r"\ban?\s+$", passage[:a0], re.I):
            art = re.search(r"(an?)\s+$", passage[:a0], re.I).group(1).lower()
            if (art == "an") != (wrong[:1].lower() in "aeiou"):
                _skip(trace, f"관사 a/an 어긋남 — {art} {wrong}")
                return None
    else:
        # 어법은 두 번에 나눠 묻는다 — 한 번에 「k번째를 틀리게」라고 하면 35B 가 번호를 자주 헷갈렸다
        # (in which → to designed 처럼 다른 밑줄의 틀린 꼴을 냈다). 밑줄 다섯 → 위치로 정렬 → k번째 구절을 글자로 주고 틀리게
        got = call(PICK_GRAMMAR_SYS, f"[Passage]\n{passage}\n\nReturn JSON.", max_tokens=300)
        items = [_clean(x) for x in ((got or {}).get("spans") or [])][:5]
        if len(items) != 5 or any(not x or len(x.split()) > 3 for x in items):
            _skip(trace, f"밑줄 다섯(1~3낱말)이 아님 — {items}")
            return None
        found = _locate_any(passage, items)
        if found is None:
            _skip(trace, f"지문에서 못 찾음 — {items}")
            return None
        items = [passage[a:b] for a, b in found]
        sent = next((x for x in split_sentences(passage) if items[k] in x), "")
        got2 = call(CORRUPT_SYS, f"[Sentence]\n{sent}\n\n[Span]\n{items[k]}\n\nReturn JSON.", max_tokens=160)
        wrong = _clean((got2 or {}).get("wrong"))
        trace.append({"stage": "pick", "k": k, "items": items, "wrong": wrong, "point": (got2 or {}).get("point")})
        if not _one_change(items[k], wrong):
            _skip(trace, f"어법 변형은 한 곳만 — {items[k]} → {wrong}")
            return None
        changed = sent.replace(items[k], wrong, 1)
        chk = call(GRAMMAR_CHECK_SYS, f"[Sentence]\n{changed}\n\nReturn JSON.", max_tokens=120, t=0.0) or {}
        trace.append({"stage": "grammar_check", "changed": changed, "grammatical": chk.get("grammatical")})
        if chk.get("grammatical") is not False:
            # in which → where, will have → has 처럼 바꿔도 맞는 문장이면 「틀린 것」이 없는 문항이 된다
            _skip(trace, f"바꿔도 맞는 문장 — {items[k]} → {wrong}")
            return None
        got = got2
    locs = found
    if locs is None:
        _skip(trace, f"지문에서 못 찾음 — {items}")
        return None
    if not _spread_ok(locs, len(passage)):
        _skip(trace, f"한쪽에 몰림 — {items}")
        return None
    if kind == "vocab":
        a0, b0 = locs[k]
        sent = next((x for x in split_sentences(passage) if passage[a0:b0] in x), "")
        changed = sent.replace(passage[a0:b0], wrong, 1)
        chk = call(VOCAB_CHECK_SYS, f"[Passage]\n{passage}\n\n[Changed sentence]\n{changed}\n\nReturn JSON.",
                   max_tokens=160, t=0.0) or {}
        trace.append({"stage": "vocab_check", "changed": changed, **{x: chk.get(x) for x in ("grammatical", "makes_sense")}})
        if chk.get("grammatical") is False or chk.get("makes_sense") is True:
            _skip(trace, f"어휘 확인 실패(비문={chk.get('grammatical') is False}·그대로도 말이 됨={chk.get('makes_sense') is True}) — "
                         f"{passage[a0:b0]} → {wrong}")
            return None
    if kind == "grammar":
        for (a0, _), sp in zip(locs, items):
            ws = sp.split()
            starts = not passage[:a0].strip() or passage[:a0].rstrip()[-1:] in ".!?\"”"
            if any(w[:1].isupper() for w in ws[1:]) or (ws[0][:1].isupper() and not starts and ws[0] != "I"):
                _skip(trace, f"고유명사에 밑줄 — {sp}")
                return None
    shown = [wrong if i == k else passage[a:b] for i, (a, b) in enumerate(locs)]
    out, prev = [], 0
    for i, (a, b) in enumerate(locs):
        mark = f"{CIRCLED[i]}{shown[i]}" if kind == "vocab" else f"{CIRCLED[i]}<u>{shown[i]}</u>"
        out.append(passage[prev:a] + mark)
        prev = b
    para = "".join(out) + passage[prev:]
    if kind == "vocab":
        options = " ### ".join(f"{CIRCLED[i]} {w}" for i, w in enumerate(shown))
        note = f"{CIRCLED[k]} {wrong} → 원래 낱말 {passage[locs[k][0]:locs[k][1]]}"
    else:
        options = "###".join(CIRCLED)
        note = f"{CIRCLED[k]} {wrong} → 바른 형태 {passage[locs[k][0]:locs[k][1]]} ({(got or {}).get('point', '')})"
    return {"paragraph": para, "options": options, "answer": CIRCLED[k], "note": note}
