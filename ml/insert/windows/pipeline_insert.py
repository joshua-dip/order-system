#!/usr/bin/env python3
"""삽입(insert) 파이프라인 — LoRA 없는 규칙 유형. 규칙 생성 → 35B 모의 풀이로 거르기 → 해설(ml/common/rule_pipeline.py).

워커 inference_child 가 다른 유형과 같은 run_pipeline 약속으로 부른다. 어댑터가 없으니 main_adapter 는 무시한다.
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

_COMMON = Path(__file__).resolve().parents[2] / "common"
if str(_COMMON) not in sys.path:
    sys.path.insert(0, str(_COMMON))

from cuda_runtime import chat_text  # noqa: E402  (맥에서는 mlx_runtime 이 이 이름으로 끼워진다)
import rule_pipeline  # noqa: E402


def run_pipeline(model: Any, tokenizer: Any, passage: str, *, max_retries: int = 2, temp: float = 0.3,
                 has_explain_adapter: bool = False, main_adapter: str | None = None,
                 explain_adapter: str = "explain") -> dict[str, Any]:
    return rule_pipeline.run("insert", chat_text, model, tokenizer, passage, temp=temp)
