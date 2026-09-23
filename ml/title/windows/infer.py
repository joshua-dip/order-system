#!/usr/bin/env python3
"""Windows CUDA 제목 LoRA 추론: 지문 → question_data JSON (stdout). Claude/API 없음.

Mac ml/title/infer.py 와 동일한 stdout 계약:
  첫 줄 JSON { ok, question_data } + (옵션) 시험지 미리보기
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

_TYPE_DIR = Path(__file__).resolve().parent.parent
_WIN_DIR = Path(__file__).resolve().parent
for p in (_TYPE_DIR, _WIN_DIR):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

from _title_common import (  # noqa: E402
    SYSTEM_PROMPT,
    format_exam_view,
    read_passage_interactive,
)
from _cuda_runtime import (  # noqa: E402
    DEFAULT_ADAPTER,
    DEFAULT_MODEL,
    adapter_exists,
    chat_json,
    load_base_model_name,
    load_model,
    resolve_use_4bit,
)


def main() -> int:
    ap = argparse.ArgumentParser(description="Local title-variant infer (Windows CUDA LoRA)")
    ap.add_argument("--model", default="", help="empty => adapter train_meta / default Qwen")
    ap.add_argument("--adapter", default=str(DEFAULT_ADAPTER))
    ap.add_argument("--passage-file", help="passage text file")
    ap.add_argument(
        "--paste",
        action="store_true",
        help="paste passage in terminal (end: Ctrl-Z Enter or END)",
    )
    ap.add_argument("--max-tokens", type=int, default=4096)
    ap.add_argument("--temp", type=float, default=0.3)
    ap.add_argument(
        "--json-only",
        action="store_true",
        help="machine parse — one JSON line only",
    )
    ap.add_argument(
        "--no-4bit",
        action="store_true",
        help="disable 4bit (GTX 1050 Ti / Pascal / low VRAM)",
    )
    args = ap.parse_args()

    if args.passage_file:
        passage = Path(args.passage_file).read_text(encoding="utf-8").strip()
    elif args.paste or sys.stdin.isatty():
        passage = read_passage_interactive()
    else:
        passage = sys.stdin.read().strip()
    if not passage:
        print("empty passage", file=sys.stderr)
        return 1

    adapter_path = Path(args.adapter)
    has_adapter = adapter_exists(adapter_path)
    model_name = (args.model or "").strip() or load_base_model_name(
        adapter_path if has_adapter else Path("."), DEFAULT_MODEL
    )
    use_4bit = resolve_use_4bit(adapter_path, args.no_4bit)

    print(
        f"passage {len(passage)} chars — loading CUDA model (4bit={use_4bit})",
        file=sys.stderr,
    )
    try:
        model, tokenizer, _flags = load_model(
            model_name,
            adapter_path if has_adapter else None,
            use_4bit,
        )
    except RuntimeError as e:
        print(str(e), file=sys.stderr)
        return 1

    parsed = chat_json(
        model,
        tokenizer,
        SYSTEM_PROMPT,
        f"[지문 Paragraph]\n{passage}",
        max_tokens=args.max_tokens,
        temp=args.temp,
    )
    if not parsed:
        print(
            json.dumps(
                {"ok": False, "error": "JSON parse failed"},
                ensure_ascii=False,
            )
        )
        return 2

    parsed["Paragraph"] = passage
    parsed["OptionType"] = "English"

    payload = {"ok": True, "question_data": parsed}
    print(json.dumps(payload, ensure_ascii=False))
    if not args.json_only:
        print(format_exam_view(parsed))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
