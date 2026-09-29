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


# Qwen 은 한국어 글 중간에 중국어 한자어를 섞는다(「전체主旨를 포괄하지 못한다」) — 학생에게 그대로 나가면 안 된다.
# 자주 나오는 말은 한국어로 바꾸고, 그래도 한자가 남은 문장은 뺀다(해설은 여러 문장이라 한 문장 빠져도 뜻이 선다).
_HAN_TERMS = {
    "主旨": "요지", "要旨": "요지", "主题": "주제", "主題": "주제", "标题": "제목", "題目": "제목", "题目": "제목",
    "核心": "핵심", "内容": "내용", "內容": "내용", "观点": "관점", "觀點": "관점", "主张": "주장", "主張": "주장",
    "因此": "따라서", "所以": "그래서", "但是": "하지만", "例如": "예를 들어", "部分": "부분", "全体": "전체", "全體": "전체",
}
_HAN = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")


def strip_han(text: str) -> str:
    if not _HAN.search(text):
        return text
    for han, ko in _HAN_TERMS.items():
        # 한글 바로 뒤에 붙어 나온 한자어는 띄어 쓴다(「전체主旨를」→「전체 요지를」)
        text = re.sub(rf"(?<=[\uac00-\ud7a3]){han}", " " + ko, text).replace(han, ko)
    if not _HAN.search(text):
        return text
    sentences = re.split(r"(?<=[.!?])\s+", text)
    return " ".join(s for s in sentences if not _HAN.search(s)).strip()


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
    text = strip_han(text)
    if not text or not any("\uac00" <= ch <= "\ud7a3" for ch in text):
        return ""
    # 「정답은 ⑤」뿐 아니라 「⑤가 정답입니다」 꼴도 본다 — 무관한 문장 해설이 「⑤가 정답입니다」라고 쓰고 정답 ①을 놓친 적이 있다
    stated = [m.group(1) for m in re.finditer(r"정답(?:은|는|:)?\s*([①②③④⑤])", text)]
    stated += [m.group(1) for m in re.finditer(r"([①②③④⑤])\s*(?:번)?(?:이|가)?\s*정답", text)]
    if any(x != answer for x in stated):
        return ""  # 해설이 다른 번호를 정답이라 한다 — 쓰면 문항과 어긋난다
    if answer and answer not in text:
        text = f"정답은 {answer}. {text}"
    return text


_QUOTE_PAIRS = (("「", "」"), ("『", "』"), ("“", "”"), ("‘", "’"), ("(", ")"))


def quotes_balanced(text: str) -> bool:
    """「」·“”·괄호가 짝이 맞고 곧은따옴표(")가 짝수인가 — 해설이 인용 도중에 잘렸는지 가린다."""
    return all(text.count(a) == text.count(b) for a, b in _QUOTE_PAIRS) and text.count('"') % 2 == 0


_END_OK = re.compile(r"(다|요|[.!?」』”)])\s*$")
_SENT_END = re.compile(r"(다\.|요\.|[.!?])(?=\s|$)")


def looks_truncated(text: str) -> bool:
    """해설이 중간에 끊긴 모양인가 — 인용이 안 닫혔거나, 「…」·「...」로 끝나거나, 문장 끝이 아니다."""
    t = text.strip()
    return (not t) or (not quotes_balanced(t)) or t.endswith(("…", "...")) or not _END_OK.search(t)


def trim_to_sentence(text: str, limit: int = 450) -> str:
    """limit 자 안에서 **인용 밖의** 마지막 문장 끝까지만 남긴다.
    예전엔 글자 수로 자르거나 영어 인용 속 마침표에서 잘라 「…making 」처럼 인용이 열린 채 끝났다(파워업 검수 P 다수).
    안전하게 자를 곳이 없으면 빈 문자열 — 호출한 쪽이 대체 해설을 쓴다."""
    t = text.strip()
    if len(t) <= limit and not looks_truncated(t):
        return t
    head = t[:limit]
    best = -1
    for m in _SENT_END.finditer(head):
        cand = head[:m.end()]
        # 「...」 말줄임은 문장 끝이 아니다. 안전한 끝이면서 인용 밖일 때만
        if m.end() >= 8 and not cand.rstrip().endswith(("..", "…")) and quotes_balanced(cand):
            best = m.end()
    if best > 0 and (best >= len(head) // 3 or len(t) <= limit):
        return head[:best].rstrip()
    return ""


def unify_end_period(options: list[str]) -> list[str]:
    """선택지 끝 마침표를 한 문항 안에서 맞춘다 — 정답만 마침표가 있으면(또는 없으면) 모양으로 답이 보인다
    (파워업 검수). 물음표·느낌표로 끝나는 선택지는 그대로 두고, 나머지를 많은 쪽에 맞춘다(같으면 뺀다)."""
    plain = [o.rstrip() for o in options]
    judged = [o for o in plain if o and not o.endswith(("?", "!"))]
    with_dot = sum(1 for o in judged if o.endswith("."))
    add = with_dot * 2 > len(judged)
    out = []
    for o in plain:
        if not o or o.endswith(("?", "!")):
            out.append(o)
        elif add:
            out.append(o if o.endswith(".") else o + ".")
        else:
            out.append(o.rstrip(".").rstrip() if o.endswith(".") and not o.endswith("...") else o)
    return out
