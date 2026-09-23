"""주장 LoRA 공용: 프롬프트·JSON 복구·시험지 미리보기 (Mac MLX / Windows CUDA 공통)."""
from __future__ import annotations

import sys
from pathlib import Path

_COMMON = Path(__file__).resolve().parent.parent / "common"
if str(_COMMON) not in sys.path:
    sys.path.insert(0, str(_COMMON))

from json_extract import extract_json_object  # noqa: E402,F401  (Mac·Windows·워커 공용 구현)

SYSTEM_PROMPT = """당신은 한국 수능 영어 변형문제 출제자입니다. 주어진 영어 지문으로 「주장」 객관식 1문항을 만듭니다.
반드시 아래 키만 갖는 JSON 한 개만 출력하세요. 마크다운·설명 금지.

키: Question, Paragraph, Options, CorrectAnswer, Explanation, OptionType

규칙:
1) Paragraph = 입력 지문 원문 그대로. <u> 태그 금지.
2) Question 예: "이 글에서 글쓴이가 주장하는 바로 가장 적절한 것은?"
3) Options = 영어 완전한 문장 5개(명사구 금지), 각 7~12단어, 사이는 오직 ###.
   must/should/have to 등 조동사 + important/essential/significant/critical/vital/necessary 등
   형용사로 문장을 완성한다. you/he/she 로 시작 금지(주어 없는 it 은 가능).
4) OptionType = "English"
5) CorrectAnswer = ①~⑤ 중 하나.
   **주제(무엇에 관한 글인가)와 주장(독자가 무엇을 해야 하는가)을 구분할 것** — 정답은 지문의
   논지에서 실천 층위로 한 단계 내려온 문장이어야 한다. 주제문의 술어만 조동사로 바꾼 문장은 실패.
   구체적 예시·우화·스토리·비유를 이름으로 언급하지 말고 원리·교훈에 집중.
6) Explanation = 한국어 해설, 450자 이하, CorrectAnswer와 하나의 결론만."""

CIRCLED = ("①", "②", "③", "④", "⑤")


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
    question = str(qd.get("Question") or "이 글에서 글쓴이가 주장하는 바로 가장 적절한 것은?").strip()
    paragraph = str(qd.get("Paragraph") or "").strip()
    options = split_options(qd.get("Options"))
    answer = str(qd.get("CorrectAnswer") or "").strip()
    explanation = str(qd.get("Explanation") or "").strip()
    if len(explanation) > 450:
        explanation = explanation[:450].rstrip() + "…"

    lines = [
        "",
        "=" * 60,
        "【주장】",
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
