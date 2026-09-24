"""모델 출력에서 JSON 객체 하나를 복구한다 — 주제·제목·주장, Mac MLX·Windows CUDA·워커 공용."""
from __future__ import annotations

import json
import re

_CIRCLED = "①②③④⑤"


def extract_json_object(text: str) -> dict | None:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        obj = json.loads(text)
        if isinstance(obj, dict):
            return obj
    except json.JSONDecodeError:
        pass

    start = text.find("{")
    if start < 0:
        return None

    # 중괄호 균형으로 첫 객체만 잘라낸다 (뒤에 잡텍스트가 있어도)
    depth = 0
    in_str = False
    esc = False
    end = -1
    for i, ch in enumerate(text[start:], start):
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end = i
                break

    candidates: list[str] = []
    if end >= 0:
        candidates.append(text[start : end + 1])
    candidates.append(text[start:])  # 잘린 JSON 복구용

    for chunk in candidates:
        try:
            obj = json.loads(chunk)
            if isinstance(obj, dict):
                return obj
        except json.JSONDecodeError:
            pass
        repaired = chunk
        if repaired.count('"') % 2 == 1:
            repaired += '"'
        repaired += "}" * max(0, repaired.count("{") - repaired.count("}"))
        try:
            obj = json.loads(repaired)
            if isinstance(obj, dict):
                return obj
        except json.JSONDecodeError:
            continue
    return None


def explanation_text(obj: dict | None, raw: str, answer: str) -> str:
    """해설 단계 출력 → 해설 문자열. 비면 호출한 쪽이 대체 문구를 쓴다.

    큰 추론 모델(Qwen3.6-35B)은 「JSON 만」이라고 해도 해설을 JSON 없이 한국어 글로만 쓰는 일이 잦다 —
    예전엔 그걸 실패로 보고 좋은 해설을 버린 뒤 「정답은 ①. 글의 핵심은 …」 대체 문구로 채웠다.
    그래서 JSON 의 Explanation 이 없으면 원문 글을 받는다(코드펜스·「Explanation:」 머리말은 벗긴다).
    정답 번호를 다르게 적었으면 버리고(빈 문자열), 번호가 아예 없으면 「정답은 ①.」을 앞에 붙인다.
    """
    text = ""
    if isinstance(obj, dict):
        text = str(obj.get("Explanation") or obj.get("explanation") or obj.get("해설") or "").strip()
    if not text and raw and "{" not in raw.strip()[:1]:
        text = raw.strip()
        if text.startswith("```"):
            text = re.sub(r"^```\w*\s*", "", text)
            text = re.sub(r"\s*```$", "", text)
        text = re.sub(r"^(Explanation|해설)\s*[:：]\s*", "", text.strip()).strip().strip('"').strip()
    if not text or not any("\uac00" <= ch <= "\ud7a3" for ch in text):
        return ""
    stated = re.search(r"정답(?:은|는|:)?\s*([①②③④⑤])", text)
    if stated and stated.group(1) != answer:
        return ""  # 해설이 다른 번호를 정답이라 한다 — 쓰면 문항과 어긋난다
    if answer and answer not in text:
        text = f"정답은 {answer}. {text}"
    return text


def trim_to_sentence(text: str, limit: int = 450) -> str:
    """limit 자 안에서 마지막 문장 끝(다. 요. . ! ?)까지만 남긴다 — 글자 수로 자르면 문장 중간에서 「…」로 끝났다."""
    if len(text) <= limit:
        return text
    head = text[:limit]
    cut = max(head.rfind(m) + len(m) for m in ("다.", "요.", ". ", "! ", "? "))
    if cut >= limit // 2:
        return head[:cut].rstrip()
    return head.rstrip() + "…"
