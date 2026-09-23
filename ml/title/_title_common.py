"""제목 LoRA 공용: 프롬프트·JSON 복구·시험지 미리보기 (Mac MLX / Windows CUDA 공통)."""
from __future__ import annotations

import json
import re
import sys

SYSTEM_PROMPT = """당신은 한국 수능 영어 변형문제 출제자입니다. 주어진 영어 지문으로 「제목」 객관식 1문항을 만듭니다.
반드시 아래 키만 갖는 JSON 한 개만 출력하세요. 마크다운·설명 금지.

키: Question, Paragraph, Options, CorrectAnswer, Explanation, OptionType

규칙:
1) Paragraph = 입력 지문 원문 그대로. <u> 태그 금지.
2) Question 예: "이 글의 제목으로 가장 적절한 것은?"
3) Options = 영어 5개, 각 7~12단어, 뉴스 헤드라인 스타일(각 선택지는 대문자로 시작), 사이는 오직 ###.
   예: ① Why Practice ... ### ② The Hidden Cost ... ### ③ ... ### ④ ... ### ⑤ ...
4) OptionType = "English"
5) CorrectAnswer = ①~⑤ 중 하나. 고유명사·인명·책제목·우화·비유의 이름 자체를 제목으로 쓰지 말 것 —
   글의 MAIN MESSAGE(핵심 메시지)에 집중.
6) Explanation = 한국어 해설, 450자 이하, CorrectAnswer와 하나의 결론만."""

CIRCLED = ("①", "②", "③", "④", "⑤")


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


def split_options(raw: object) -> list[str]:
    parts = [p.strip() for p in str(raw or "").split("###")]
    parts = [p for p in parts if p]
    out: list[str] = []
    for i, p in enumerate(parts[:5]):
        if not p.startswith(CIRCLED):
            p = f"{CIRCLED[i]} {p}"
        out.append(p)
    return out


def format_exam_view(qd: dict) -> str:
    """시험지처럼 보이는 텍스트."""
    question = str(qd.get("Question") or "이 글의 제목으로 가장 적절한 것은?").strip()
    paragraph = str(qd.get("Paragraph") or "").strip()
    options = split_options(qd.get("Options"))
    answer = str(qd.get("CorrectAnswer") or "").strip()
    explanation = str(qd.get("Explanation") or "").strip()
    if len(explanation) > 450:
        explanation = explanation[:450].rstrip() + "…"

    lines = [
        "",
        "=" * 60,
        "【제목】",
        "",
        question,
        "",
        paragraph,
        "",
    ]
    if options:
        lines.append("[선지]")
        for opt in options:
            lines.append(opt)
        lines.append("")
    lines.append("-" * 60)
    lines.append(f"정답: {answer or '(미정)'}")
    if explanation:
        lines.append("")
        lines.append("[해설]")
        lines.append(explanation)
    lines.append("=" * 60)
    return "\n".join(lines)


def read_passage_interactive() -> str:
    """터미널에 지문 붙여넣기 → 마지막에 Ctrl-Z Enter (Windows) / Ctrl-D (Unix) 또는 단독 줄 END.

    빈 줄 두 번으로 끊지 않는다. 지문 중간 빈 줄이 있으면 잘리기 때문.
    """
    print(
        "영어 지문을 붙여넣으세요.\n"
        "끝낼 때: Ctrl-Z 후 Enter (Windows) / Ctrl-D (Mac·Linux)\n"
        "         또는 맨 마지막 줄에 END 만 입력 후 Enter\n"
        "----------------------------------------",
        file=sys.stderr,
    )
    lines: list[str] = []
    try:
        while True:
            line = sys.stdin.readline()
            if line == "":
                break  # EOF
            if line.strip() == "END" and any(s.strip() for s in lines):
                break
            lines.append(line)
    except KeyboardInterrupt:
        print("\n취소됨.", file=sys.stderr)
        return ""
    return "".join(lines).strip()
