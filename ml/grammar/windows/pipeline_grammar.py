#!/usr/bin/env python3
"""어법(grammar) 파이프라인 — LoRA 없는 유형. 자리는 코드가, 바꿀 것 하나는 35B 가 → 35B 모의 풀이로 거르기 → 해설
(ml/common/edit_pipeline.py). 워커 inference_child 가 다른 유형과 같은 run_pipeline 약속으로 부른다.
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

_COMMON = Path(__file__).resolve().parents[2] / "common"
if str(_COMMON) not in sys.path:
    sys.path.insert(0, str(_COMMON))

from cuda_runtime import chat_text  # noqa: E402  (맥에서는 mlx_runtime 이 이 이름으로 끼워진다)
import edit_pipeline  # noqa: E402


def run_pipeline(model: Any, tokenizer: Any, passage: str, *, max_retries: int = 2, temp: float = 0.3,
                 has_explain_adapter: bool = False, main_adapter: str | None = None,
                 explain_adapter: str = "explain") -> dict[str, Any]:
    return edit_pipeline.run("grammar", chat_text, model, tokenizer, passage, temp=temp)
