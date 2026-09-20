#!/usr/bin/env python3
"""주제 LoRA 추론: 지문 → question_data JSON (stdout). Claude/API 없음."""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

SYSTEM_PROMPT = """당신은 한국 수능 영어 변형문제 출제자입니다. 주어진 영어 지문으로 「주제」 객관식 1문항을 만듭니다.
반드시 아래 키만 갖는 JSON 한 개만 출력하세요. 마크다운·설명 금지.

키: Question, Paragraph, Options, CorrectAnswer, Explanation, OptionType

규칙:
1) Paragraph = 입력 지문 원문 그대로. <u> 태그 금지.
2) Question 예: "이 글의 주제로 가장 적절한 것은?"
3) Options = 영어 명사구 5개, 각 8~15단어, 사이는 오직 ###. 예: ① ... ### ② ... ### ③ ... ### ④ ... ### ⑤ ...
4) OptionType = "English"
5) CorrectAnswer = ①~⑤ 중 하나 (주장/실천 문장 금지 — 「무엇에 관한 글인가」)
6) Explanation = 한국어 해설, 450자 이하, CorrectAnswer와 하나의 결론만."""


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
    m = re.search(r"\{[\s\S]*", text)
    if not m:
        return None
    chunk = m.group(0)
    try:
        obj = json.loads(chunk)
        return obj if isinstance(obj, dict) else None
    except json.JSONDecodeError:
        pass
    # 생성 길이 한도로 잘린 JSON — 문자열·중괄호만 닫아서 복구 시도
    repaired = chunk
    if repaired.count('"') % 2 == 1:
        repaired += '"'
    repaired += "}" * max(0, repaired.count("{") - repaired.count("}"))
    try:
        obj = json.loads(repaired)
        return obj if isinstance(obj, dict) else None
    except json.JSONDecodeError:
        return None


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
    question = str(qd.get("Question") or "이 글의 주제로 가장 적절한 것은?").strip()
    paragraph = str(qd.get("Paragraph") or "").strip()
    options = split_options(qd.get("Options"))
    answer = str(qd.get("CorrectAnswer") or "").strip()
    explanation = str(qd.get("Explanation") or "").strip()
    if len(explanation) > 450:
        explanation = explanation[:450].rstrip() + "…"

    lines = [
        "",
        "=" * 60,
        "【주제】",
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
    """터미널에 지문 붙여넣기 → 마지막에 Ctrl-D (또는 단독 줄 END)로 종료.

    빈 줄 두 번으로 끊지 않는다. 지문 중간 빈 줄이 있으면 잘리기 때문.
    """
    print(
        "영어 지문을 붙여넣으세요.\n"
        "끝낼 때: Ctrl-D  (또는 맨 마지막 줄에 END 만 입력 후 Enter)\n"
        "----------------------------------------",
        file=sys.stderr,
    )
    lines: list[str] = []
    try:
        while True:
            line = sys.stdin.readline()
            if line == "":
                break  # EOF (Ctrl-D)
            if line.strip() == "END" and any(s.strip() for s in lines):
                break
            lines.append(line)
    except KeyboardInterrupt:
        print("\n취소됨.", file=sys.stderr)
        return ""
    return "".join(lines).strip()


def main() -> int:
    ap = argparse.ArgumentParser(description="Local topic-variant infer (MLX LoRA)")
    ap.add_argument("--model", default="mlx-community/Llama-3.2-3B-Instruct-4bit")
    ap.add_argument(
        "--adapter",
        default=str(Path(__file__).resolve().parent / "adapters" / "topic-lora"),
    )
    ap.add_argument("--passage-file", help="지문 텍스트 파일")
    ap.add_argument(
        "--paste",
        action="store_true",
        help="터미널에 지문 붙여넣기 (끝: Ctrl-D 또는 END)",
    )
    ap.add_argument("--max-tokens", type=int, default=4096)
    ap.add_argument("--temp", type=float, default=0.3)
    ap.add_argument(
        "--json-only",
        action="store_true",
        help="기계 파싱용 — JSON 한 줄만 출력 (문제 미리보기 생략)",
    )
    args = ap.parse_args()

    if args.passage_file:
        passage = Path(args.passage_file).read_text(encoding="utf-8").strip()
    elif args.paste or sys.stdin.isatty():
        passage = read_passage_interactive()
    else:
        passage = sys.stdin.read().strip()
    if not passage:
        print("지문이 비어 있습니다.", file=sys.stderr)
        return 1

    print(f"지문 {len(passage)}자 — 모델 로딩·생성 중…", file=sys.stderr)
    try:
        from mlx_lm import load, generate
        from mlx_lm.sample_utils import make_sampler
    except ImportError:
        print("mlx_lm 없음. ml/topic 에서: pip install -r requirements.txt", file=sys.stderr)
        return 1

    adapter = args.adapter if Path(args.adapter).exists() else None
    if adapter is None:
        print(f"경고: adapter 없음 ({args.adapter}) — 베이스 모델만 사용", file=sys.stderr)

    model, tokenizer = load(args.model, adapter_path=adapter)

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": f"[지문 Paragraph]\n{passage}"},
    ]
    if hasattr(tokenizer, "apply_chat_template"):
        prompt = tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True
        )
    else:
        prompt = (
            SYSTEM_PROMPT
            + "\n\n"
            + f"[지문 Paragraph]\n{passage}\n\nJSON:"
        )

    sampler = make_sampler(temp=args.temp)
    text = generate(
        model,
        tokenizer,
        prompt=prompt,
        max_tokens=args.max_tokens,
        verbose=False,
        sampler=sampler,
    )
    if not isinstance(text, str):
        text = str(text)
    if text.startswith(prompt):
        text = text[len(prompt) :]

    parsed = extract_json_object(text)
    if not parsed:
        print(json.dumps({"ok": False, "error": "JSON 파싱 실패", "raw": text[:2000]}, ensure_ascii=False))
        return 2

    # Paragraph 강제: 원문 유지
    parsed["Paragraph"] = passage
    parsed["OptionType"] = "English"

    payload = {"ok": True, "question_data": parsed}
    # 첫 줄 JSON — cc-topic-local 등 파서가 쓰기 쉽게
    print(json.dumps(payload, ensure_ascii=False))
    if not args.json_only:
        print(format_exam_view(parsed))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
