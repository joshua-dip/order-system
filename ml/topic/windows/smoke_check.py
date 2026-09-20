#!/usr/bin/env python3
"""GPU 없이 파이프라인 골격만 확인 (Windows/Linux 공통).

  python smoke_check.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

_WINDOWS = Path(__file__).resolve().parent
_TOPIC = _WINDOWS.parent
_ROOT = _TOPIC.parent.parent
sys.path.insert(0, str(_TOPIC))

from _topic_common import extract_json_object, SYSTEM_PROMPT  # noqa: E402


def main() -> int:
    errors: list[str] = []

    if "주제" not in SYSTEM_PROMPT or "CorrectAnswer" not in SYSTEM_PROMPT:
        errors.append("SYSTEM_PROMPT 내용이 비정상입니다.")

    sample = '{"Question":"이 글의 주제로 가장 적절한 것은?","Paragraph":"Hello.","Options":"① a ### ② b ### ③ c ### ④ d ### ⑤ e","CorrectAnswer":"①","Explanation":"테스트","OptionType":"English"}'
    parsed = extract_json_object(f"여기 JSON:\n{sample}\n끝")
    if not parsed or parsed.get("CorrectAnswer") != "①":
        errors.append("extract_json_object 실패")

    truncated = '{"Question":"x","Paragraph":"y","Options":"① a ### ② b'
    if extract_json_object(truncated) is None:
        # 복구가 안 돼도 치명적이진 않음 — 경고만
        print("warn: truncated JSON 복구는 이 샘플에서 실패 (정상일 수 있음)", file=sys.stderr)

    for rel in (
        "train.py",
        "infer.py",
        "setup.bat",
        "train.bat",
        "ask.bat",
        "requirements.txt",
        "README.md",
    ):
        if not (_WINDOWS / rel).is_file():
            errors.append(f"파일 없음: {rel}")

    data = _ROOT / "data" / "topic-finetune" / "train.jsonl"
    if data.is_file():
        n = sum(1 for line in data.open(encoding="utf-8") if line.strip())
        print(f"ok: train.jsonl {n} lines")
    else:
        print("info: train.jsonl 아직 없음 — npm run cc:topic-export 필요")

    # argparse 만 로드 (CUDA/torch import 전에 스크립트 존재 확인)
    import ast

    for name in ("train.py", "infer.py"):
        src = (_WINDOWS / name).read_text(encoding="utf-8")
        try:
            ast.parse(src)
        except SyntaxError as e:
            errors.append(f"{name} 문법 오류: {e}")

    docs = _ROOT / "docs" / "ml" / "topic-windows-cuda.md"
    if not docs.is_file():
        errors.append("docs/ml/topic-windows-cuda.md 없음")

    if errors:
        print(json.dumps({"ok": False, "errors": errors}, ensure_ascii=False, indent=2))
        return 1

    print(json.dumps({"ok": True, "msg": "Windows CUDA 파이프라인 골격 OK"}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
