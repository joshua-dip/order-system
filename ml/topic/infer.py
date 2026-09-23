#!/usr/bin/env python3
"""주제 LoRA 추론: 지문 → question_data JSON (stdout). Claude/API 없음. (Mac MLX)"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from _topic_common import (
    SYSTEM_PROMPT,
    extract_json_object,
    format_exam_view,
    read_passage_interactive,
)


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
