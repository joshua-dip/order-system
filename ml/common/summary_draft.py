"""35B 요약 대안 초안: 완성 문장의 두 표현을 코드로 정확히 한 번씩 가린다."""
from __future__ import annotations

import re


def draft_from_spans(draft: dict | None) -> dict | None:
    """모델이 준 위치를 추측하지 않는다. 단어 경계·유일한 등장·A/B 순서를 확인한다."""
    if not isinstance(draft, dict):
        return None
    sentence = draft.get("sentence")
    a, b = draft.get("A"), draft.get("B")
    distractors = draft.get("distractors")
    if not isinstance(sentence, str) or not isinstance(a, str) or not isinstance(b, str):
        return None
    sentence = " ".join(sentence.split())
    a, b = " ".join(a.split()), " ".join(b.split())
    if not all(re.fullmatch(r"[A-Za-z]+(?:['’-][A-Za-z]+)*(?: [A-Za-z]+(?:['’-][A-Za-z]+)*){0,2}", word)
               for word in (a, b)):
        return None
    if a.lower() == b.lower() or re.search(r"\([AB]\)|_", sentence):
        return None
    spans = []
    for word in (a, b):
        hits = list(re.finditer(r"(?<![\w'’-])" + re.escape(word) + r"(?![\w'’-])", sentence, re.IGNORECASE))
        if len(hits) != 1:
            return None
        spans.append(hits[0].span())
    if spans[0][1] > spans[1][0]:
        return None
    if not isinstance(distractors, list) or len(distractors) != 4:
        return None
    if any(not isinstance(pair, list) or len(pair) != 2 or
           any(not isinstance(word, str) or not word.strip() for word in pair) for pair in distractors):
        return None
    # 원문에 실제 쓰인 대소문자를 보존하고, 뒤쪽부터 가려 앞쪽 오프셋을 유지한다.
    correct = [sentence[start:end] for start, end in spans]
    for label, (start, end) in reversed(list(zip("AB", spans))):
        sentence = sentence[:start] + f"({label}) ________" + sentence[end:]
    return {"summary": sentence, "pairs": [correct, *distractors], "answer": 1}
