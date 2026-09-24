"""선지 모양 검사 — 주제는 명사구, 제목은 헤드라인. 모델에게 묻지 않고 코드가 센다(노트 12과).

26년 9월 고1 18지문 시험에서 정답이 문장으로 나왔다:
  주제 36번 「mathematics focuses on patterns, …」, 29번 「the transition … explains initial discomfort …」
  제목 39번 「Leaf-cutter ants cultivate fungus as food, demonstrating an agricultural civilization.」
검증기가 뜻만 보고 통과시키거나, 끝까지 못 고치면 핵심 메시지 문장을 그대로 정답 자리에 넣었기 때문.
"""
from __future__ import annotations

import re

# 명사구 안에 나오면 문장이 되는 동사 — 명사로도 쓰이는 needs·shapes·changes·plays·means 는 뺐다(오탐)
_VERBS = {
    "is", "are", "was", "were", "explains", "focuses", "shows", "causes", "allows", "helps", "leads", "requires",
    "depends", "determines", "affects", "creates", "proves", "lies", "becomes", "remains", "enables", "reveals",
    "suggests", "argues", "makes", "can", "will", "should", "must", "does", "cannot",
}
# 이 말 뒤의 동사는 명사구 안의 절이라 괜찮다 — 「how X shapes Y」「the idea that X is Y」「the way X is buried」
_OPENERS = {"how", "why", "what", "whether", "when", "where", "which", "that", "who", "whom", "whose", "way"}


def _tokens(s: str) -> list[str]:
    return [t for t in re.findall(r"[a-z']+", s.lower())]


def topic_form_issue(s: str) -> str | None:
    """주제 선지가 명사구가 아니라 문장이면 사유."""
    s = s.strip()
    if s.endswith("."):
        return "ends with a period — write a noun phrase, not a sentence"
    toks = _tokens(s)
    for i, t in enumerate(toks):
        if t in _VERBS and not any(o in _OPENERS for o in toks[:i]):
            return f"a sentence (verb '{t}'), not a noun phrase — write e.g. 'the role of …' / 'how …'"
    return None


def title_form_issue(s: str) -> str | None:
    """제목 선지가 헤드라인(Title Case, 마침표 없음)이 아니면 사유."""
    s = s.strip()
    if s.endswith("."):
        return "ends with a period — write a headline, not a sentence"
    long_words = [w for w in re.findall(r"[A-Za-z][A-Za-z'-]*", s) if len(w) >= 4]
    if long_words:
        caps = sum(1 for w in long_words if w[0].isupper())
        if caps / len(long_words) < 0.6:
            return "not a headline — capitalize the main words (Title Case)"
    return None
