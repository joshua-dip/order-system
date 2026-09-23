#!/usr/bin/env python3
"""GPU-free smoke check for Windows/Linux title LoRA pipeline.

  python smoke_check.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

# Windows cp949 consoles choke on some Unicode (em-dash, etc.)
for stream in (sys.stdout, sys.stderr):
    try:
        stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

_WINDOWS = Path(__file__).resolve().parent
_TYPE = _WINDOWS.parent
_ROOT = _TYPE.parent.parent
sys.path.insert(0, str(_TYPE))

from _title_common import extract_json_object, SYSTEM_PROMPT  # noqa: E402


def main() -> int:
    errors: list[str] = []

    if "제목" not in SYSTEM_PROMPT or "CorrectAnswer" not in SYSTEM_PROMPT:
        errors.append("SYSTEM_PROMPT invalid")

    sample = '{"Question":"이 글의 제목으로 가장 적절한 것은?","Paragraph":"Hello.","Options":"① a ### ② b ### ③ c ### ④ d ### ⑤ e","CorrectAnswer":"①","Explanation":"테스트","OptionType":"English"}'
    parsed = extract_json_object(f"여기 JSON:\n{sample}\n끝")
    if not parsed or parsed.get("CorrectAnswer") != "①":
        errors.append("extract_json_object failed")

    truncated = '{"Question":"x","Paragraph":"y","Options":"① a ### ② b'
    if extract_json_object(truncated) is None:
        print("warn: truncated JSON repair failed on this sample (may be OK)", file=sys.stderr)

    for rel in (
        "train.py",
        "infer.py",
        "pipeline_title.py",
        "_cuda_runtime.py",
        "setup.bat",
        "train.bat",
        "ask.bat",
        "ask_pipeline.bat",
        "train_explain.bat",
        "requirements.txt",
        "README.md",
    ):
        if not (_WINDOWS / rel).is_file():
            errors.append(f"missing file: {rel}")

    data = _ROOT / "data" / "title-finetune" / "train.jsonl"
    if data.is_file():
        n = sum(1 for line in data.open(encoding="utf-8") if line.strip())
        print(f"ok: train.jsonl {n} lines")
    else:
        print("info: train.jsonl missing - run npm run cc:title-export")

    import ast

    for name in ("train.py", "infer.py", "pipeline_title.py", "_cuda_runtime.py"):
        src = (_WINDOWS / name).read_text(encoding="utf-8")
        try:
            ast.parse(src)
        except SyntaxError as e:
            errors.append(f"{name} syntax error: {e}")

    docs = _ROOT / "docs" / "ml" / "title-windows-cuda.md"
    if not docs.is_file():
        errors.append("docs/ml/title-windows-cuda.md missing")

    if errors:
        print(json.dumps({"ok": False, "errors": errors}, ensure_ascii=True, indent=2))
        return 1

    print(json.dumps({"ok": True, "msg": "Windows CUDA pipeline skeleton OK"}, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
