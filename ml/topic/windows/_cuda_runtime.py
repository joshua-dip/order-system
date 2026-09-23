"""주제 어댑터 경로 상수 + 공용 CUDA 런타임(ml/common/cuda_runtime.py) 재수출.

로드·생성 코드는 세 유형(주제·제목·주장)이 한 벌을 같이 쓴다 — 워커가 한 프로세스에서
세 파이프라인을 불러도 같은 코드가 돌게 하려는 것.
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

DEFAULT_ADAPTER = _TYPE_DIR / "adapters" / "topic-lora-cuda"
DEFAULT_EXPLAIN_ADAPTER = _TYPE_DIR / "adapters" / "topic-explain-lora-cuda"
DEFAULT_MODEL = "Qwen/Qwen2.5-7B-Instruct"
