"""내용일치(fact) 어댑터 경로 상수 + 공용 런타임(ml/common/cuda_runtime.py) 재수출.

맥 워커에서는 inference_child 가 mlx_runtime 을 cuda_runtime 자리에 끼워 넣으므로 같은 이름으로 MLX 가 돈다.
"""
from __future__ import annotations

import sys
from pathlib import Path

_TYPE_DIR = Path(__file__).resolve().parent.parent
_COMMON = _TYPE_DIR.parent / "common"
if str(_COMMON) not in sys.path:
    sys.path.insert(0, str(_COMMON))

from cuda_runtime import (  # noqa: E402,F401
    adapter_exists,
    chat_json,
    chat_text,
    load_base_model_name,
    load_model,
    resolve_use_4bit,
    set_adapter,
)

DEFAULT_ADAPTER = _TYPE_DIR / "adapters" / "fact-lora"
DEFAULT_EXPLAIN_ADAPTER = _TYPE_DIR / "adapters" / "fact-explain-lora"
DEFAULT_MODEL = "mlx-community/Qwen2.5-7B-Instruct-4bit"
