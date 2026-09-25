"""순서·삽입 규칙 생성 — 학습실 lib/practice-generator.ts 를 파이썬으로 옮긴 것(워커 파이프라인용).

LoRA 가 없는 유형이다. 지문 원문을 문장으로 나눠 규칙으로 문항을 만들고, 풀 만한지는 파이프라인이
35B 모의 풀이로 거른다(ml/order·ml/insert). 규칙은 학습실과 같게 둔다 — 한쪽을 고치면 다른 쪽도 맞출 것:
  · 덩이 시작·빠지는 문장은 연결 단서(However·This·For example …)가 있는 자리를 우선
  · 정답 번호를 먼저 고르게 뽑는다(삽입은 뺄 문장부터 고르면 ①이 쏠린다)
"""
from __future__ import annotations

import random
import re

CIRCLED = "①②③④⑤"
# 순서 보기 — 표준 5세트(DB 표기: 공백 없는 「(A)-(C)-(B)」)
ORDER_OPTIONS = ["(A)-(C)-(B)", "(B)-(A)-(C)", "(B)-(C)-(A)", "(C)-(A)-(B)", "(C)-(B)-(A)"]
# 보기 번호 → 표시 위치 A·B·C 에 놓을 원래 덩이(읽기 순서 0·1·2)
ANSWER_TO_DISPLAY = [(0, 2, 1), (1, 0, 2), (2, 0, 1), (1, 2, 0), (2, 1, 0)]

CUE_START = re.compile(
    r'^["“]?(However|But|Yet|Instead|Still|Nevertheless|Nonetheless|Therefore|Thus|Hence|Consequently|As a result|'
    r"For example|For instance|In addition|Moreover|Furthermore|Besides|Also|Similarly|Likewise|In contrast|"
    r"On the other hand|In other words|That is|Then|Finally|Afterward|Later|This|These|That|Those|Such|It|They|He|"
    r"She|His|Her|Their|Its|The same|Another|Other|Both|Otherwise|Meanwhile|In fact|Indeed|So)\b"
)


_ABBREV = re.compile(r"(?:^|[\s(\"“])(?:[A-Z]|Mr|Mrs|Ms|Dr|St|Jr|Sr|Prof|Mt|No|vs|etc|e\.g|i\.e|U\.S|U\.K)\.$")


def split_sentences(original: str) -> list[str]:
    """원문 → 문장. 따옴표 안 대사에서는 끊지 않고, 너무 짧은 조각(약어 끊김)은 앞 문장에 붙인다."""
    text = re.sub(r"\s+", " ", original).strip()
    out: list[str] = []
    start, in_quote, i = 0, False, 0
    while i < len(text):
        ch = text[i]
        if ch == '"':
            in_quote = not in_quote
        elif ch == "“":
            in_quote = True
        elif ch == "”":
            in_quote = False
        # 이니셜·약어 뒤의 마침표에서는 끊지 않는다 — 「Theodore M. Porter」가 둘로 쪼개져 삽입 마커가 이름 한가운데 들어갔다
        if ch == "." and _ABBREV.search(text[: i + 1]):
            i += 1
            continue
        if ch in ".!?":
            j = i + 1
            after = in_quote
            while j < len(text) and text[j] in "\"”'’)":
                if text[j] == '"':
                    after = not after
                elif text[j] == "”":
                    after = False
                j += 1
            if not after and j < len(text) and text[j] == " " and re.match(r'[A-Z"“(]', text[j + 1] if j + 1 < len(text) else ""):
                out.append(text[start:j].strip())
                start = j + 1
                in_quote = after
                i = j
        i += 1
    if start < len(text):
        out.append(text[start:].strip())
    merged: list[str] = []
    for s in out:
        if len(s) < 12 and merged:
            merged[-1] += f" {s}"
        else:
            merged.append(s)
    return merged


def _cue(sentence: str | None) -> int:
    return 1 if sentence and CUE_START.match(sentence.strip()) else 0


def _weighted(items: list, weight, r: random.Random):
    ws = [max(0.05, weight(x)) for x in items]
    t = r.random() * sum(ws)
    for x, w in zip(items, ws):
        t -= w
        if t <= 0:
            return x
    return items[-1]


def generate_order(sentences: list[str], seed: int) -> dict | None:
    """도입 1~2문장 + 연속 3덩이. 덩이 시작은 단서 문장을 우선."""
    n = len(sentences)
    if n < 5:
        return None
    r = random.Random(seed)
    intro_len = 2 if n >= 9 and r.random() < 0.5 else 1
    rest = n - intro_len
    if rest < 3:
        return None
    min_size = 2 if rest >= 6 else 1
    cands = []
    for b1 in range(min_size, rest - 2 * min_size + 1):
        for b2 in range(b1 + min_size, rest - min_size + 1):
            sizes = [b1, b2 - b1, rest - b2]
            if max(sizes) - min(sizes) > max(2, -(-rest // 3)):
                continue
            cands.append((b1, b2))
    if not cands:
        return None
    body = sentences[intro_len:]
    b1, b2 = _weighted(cands, lambda c: 1 + 2 * (_cue(body[c[0]]) + _cue(body[c[1]])) + _cue(body[0]), r)
    chunks = [" ".join(body[:b1]), " ".join(body[b1:b2]), " ".join(body[b2:])]
    answer = r.randrange(5)
    a, b, c = ANSWER_TO_DISPLAY[answer]
    return {
        "intro": " ".join(sentences[:intro_len]),
        "A": chunks[a], "B": chunks[b], "C": chunks[c],
        "answer": answer,
        "ordered": [" ".join(sentences[:intro_len]), *chunks],
    }


def generate_insert(sentences: list[str], seed: int) -> dict | None:
    """첫 문장이 아닌 한 문장을 빼고, 연속한 다섯 틈 앞에 ①~⑤. 자신·다음 문장이 단서로 시작하면 우선."""
    n = len(sentences)
    m = n - 1
    if n < 6 or m < 5:
        return None
    r = random.Random(seed)
    answer = r.randrange(5)
    ts = list(range(answer + 1, m - 4 + answer + 1))
    if not ts:
        return None
    t = _weighted(ts, lambda i: 1 + 2 * _cue(sentences[i]) + 2 * _cue(sentences[i + 1] if i + 1 < n else None), r)
    remain = [s for i, s in enumerate(sentences) if i != t]
    s0 = t - answer
    parts = [remain[0]]
    for g in range(1, m + 1):
        if s0 <= g <= s0 + 4:
            parts.append(CIRCLED[g - s0])
        if g < m:
            parts.append(remain[g])
    return {
        "given": sentences[t],
        "body": " ".join(parts),
        "answer": answer,
        "before": sentences[t - 1] if t >= 1 else "",
        "after": sentences[t + 1] if t + 1 < n else "",
    }
