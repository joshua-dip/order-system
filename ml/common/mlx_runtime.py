"""Apple Silicon(MLX) 런타임 — cuda_runtime.py 와 같은 이름·인자로 만든 맥 판.

파이프라인(ml/*/windows/pipeline_*.py)은 `_cuda_runtime` → `cuda_runtime` 에서
chat_json · set_adapter · (adapter_off 를 쓰는 chat_text) 만 가져다 쓴다. 맥에서는 import 전에
`use_as_cuda_runtime()` 으로 이 모듈을 `cuda_runtime` 자리에 끼워 넣어, 파이프라인 코드를 그대로 쓴다.

MLX 는 peft 처럼 한 모델에 어댑터를 여럿 붙였다 뗐다 하지 않는다. 그래서 베이스 모델과
어댑터별 모델을 따로 올려 두고(7B 4bit 한 벌에 약 4.3GB — 64GB 통합 메모리엔 여유) 고른다.
mlx 는 함수 안에서만 import 한다 — 모듈 import 만으로 GPU 를 건드리지 않게.
"""
from __future__ import annotations

import contextlib
import os
import time
import json
import sys
from pathlib import Path
from typing import Any, Iterator

_COMMON = Path(__file__).resolve().parent
if str(_COMMON) not in sys.path:
    sys.path.insert(0, str(_COMMON))

from json_extract import extract_json_object  # noqa: E402

BACKEND = "mlx"
# 호출별 시간 기록 — 워커·평가가 문항 하나 만들기 전에 비우고 끝나면 읽는다(어느 단계가 느린지 재기, 동작에는 영향 없음)
CALL_LOG: list[dict] = []
# 해설 건너뛰기(2026-09-29) — 해설은 검수 때 Claude 가 쓴다. 해설 프롬프트(「…해설만 …」)는 모델을 부르지 않고 빈 해설을 돌려준다
SKIP_EXPLAIN = os.environ.get("LOCAL_VARIANT_SKIP_EXPLAIN") == "1"
_BASE = "__base__"
_REASONER = "__reasoner__"


def use_as_cuda_runtime() -> None:
    """이 모듈을 `cuda_runtime` 이름으로 등록한다 — 파이프라인·_cuda_runtime 을 import 하기 전에 부를 것."""
    sys.modules["cuda_runtime"] = sys.modules[__name__]


class MlxModel:
    """베이스 + 이름 붙인 어댑터 모델 묶음. set_adapter / disable_adapter 는 peft 와 같은 뜻."""

    def __init__(self, base_name: str, base_model: Any, tokenizer: Any = None) -> None:
        self.base_name = base_name
        self.models: dict[str, Any] = {_BASE: base_model}
        # 모델마다 토크나이저가 다를 수 있다(추론 전용 큰 모델) — 이름별로 둔다
        self.tokenizers: dict[str, Any] = {_BASE: tokenizer}
        self.active = _BASE
        self._off = 0
        # 7B 한 벌 + LoRA 층 한 번 — 어댑터는 가중치(23MB)만 들고 있다가 바꿔 끼운다(예전: 어댑터마다 7B 를 통째로 한 벌씩, 고정 메모리 51GB)
        self.adapter_weights: dict[str, list] = {}
        self._loaded: str | None = None

    def set_adapter(self, name: str) -> None:
        if name not in self.models:
            raise KeyError(f"어댑터 없음: {name} (있는 것: {[k for k in self.models if k != _BASE]})")
        self.active = name

    @contextlib.contextmanager
    def disable_adapter(self) -> Iterator[None]:
        self._off += 1
        try:
            yield
        finally:
            self._off -= 1

    def _current_name(self) -> str:
        if self._off:
            # 어댑터를 끈 단계(주장·검증·해설)는 추론 전용 큰 모델이 있으면 그쪽으로
            return _REASONER if _REASONER in self.models else _BASE
        return self.active

    def current(self) -> Any:
        name = self._current_name()
        if self.adapter_weights and name != _REASONER and name != self._loaded:
            # 같은 7B 에 이 어댑터 가중치를 끼운다(_BASE 는 LoRA B 를 0 으로 — 베이스와 같은 출력)
            self.models[_BASE].load_weights(self.adapter_weights[name], strict=False)
            self._loaded = name
        return self.models[name]

    def current_tokenizer(self) -> Any:
        name = self._current_name()
        return self.tokenizers.get(name) or self.tokenizers.get(_BASE)


def load_base_model_name(adapter: Path, fallback: str) -> str:
    """train_meta.json 의 base_model → MLX adapter_config.json 의 model → HF 의 base_model_name_or_path."""
    for fname, key in (("train_meta.json", "base_model"), ("adapter_config.json", "model"),
                       ("adapter_config.json", "base_model_name_or_path")):
        path = adapter / fname
        if not path.is_file():
            continue
        try:
            name = json.loads(path.read_text(encoding="utf-8")).get(key)
        except (json.JSONDecodeError, OSError):
            continue
        if isinstance(name, str) and name.strip():
            return name.strip()
    return fallback


def adapter_exists(adapter: Path) -> bool:
    return adapter.is_dir() and (adapter / "adapter_config.json").is_file() and (adapter / "adapters.safetensors").is_file()


def resolve_use_4bit(adapter: Path, no_4bit_flag: bool) -> bool:
    """MLX 는 양자화가 모델 이름(…-4bit)에 들어 있다 — 인자는 인터페이스 호환용."""
    return not no_4bit_flag


def load_base(model_name: str, use_4bit: bool = True) -> tuple[MlxModel, Any]:
    from mlx_lm import load

    model, tokenizer = load(model_name)
    return MlxModel(model_name, model, tokenizer), tokenizer


def attach_adapters(model: MlxModel, adapters: list[tuple[str, Path]]) -> MlxModel:
    """베이스 7B 에 LoRA 층을 한 번만 붙이고 어댑터별 가중치만 메모리에 둔다. 첫 어댑터를 켠 상태로 돌려준다(peft 와 같음).
    어댑터 설정(층 수·rank·scale·keys)이 모두 같아야 한다 — 다르면 예전처럼 어댑터마다 모델을 따로 올린다."""
    if not adapters:
        return model
    import mlx.core as mx
    from mlx_lm.tuner.utils import linear_to_lora_layers

    def cfg(path: Path) -> tuple:
        c = json.loads((path / "adapter_config.json").read_text(encoding="utf-8"))
        return (c.get("fine_tune_type", "lora"), c.get("num_layers"), json.dumps(c.get("lora_parameters"), sort_keys=True))

    if len({cfg(p) for _, p in adapters}) != 1 or cfg(adapters[0][1])[0] != "lora":
        from mlx_lm import load
        for name, path in adapters:
            adapted, tok = load(model.base_name, adapter_path=str(path))
            model.models[name] = adapted
            model.tokenizers[name] = tok
        model.active = adapters[0][0]
        return model

    base = model.models[_BASE]
    c = json.loads((adapters[0][1] / "adapter_config.json").read_text(encoding="utf-8"))
    linear_to_lora_layers(base, c["num_layers"], c["lora_parameters"])
    base.eval()
    for name, path in adapters:
        w = mx.load(str(path / "adapters.safetensors"))
        model.adapter_weights[name] = list(w.items())
        model.models[name] = base
        model.tokenizers[name] = model.tokenizers[_BASE]
    # 어댑터 없음 = LoRA B 를 0 으로(A 는 아무 값이어도 기여 0)
    first = dict(model.adapter_weights[adapters[0][0]])
    model.adapter_weights[_BASE] = [(k, mx.zeros_like(v) if k.endswith("lora_b") else v) for k, v in first.items()]
    model.active = adapters[0][0]
    return model


def attach_reasoner(model: MlxModel, reasoner_name: str) -> MlxModel:
    """어댑터를 끈 단계(주장 뽑기·검증·해설)를 맡을 큰 범용 모델을 붙인다. 초안은 여전히 LoRA 모델이 쓴다.
    LoRA 는 문항 형식만 배웠고 독해는 베이스 몫이라, 독해가 필요한 단계만 큰 모델로 바꾸는 것."""
    from mlx_lm import load

    reasoner, tok = load(reasoner_name)
    model.models[_REASONER] = reasoner
    model.tokenizers[_REASONER] = tok
    return model


def load_model(
    model_name: str,
    adapter: Path | None,
    use_4bit: bool,
    explain_adapter: Path | None = None,
) -> tuple[MlxModel, Any, dict[str, bool]]:
    """단독 CLI 용 — 주 어댑터 "default", 해설 어댑터 "explain"."""
    model, tokenizer = load_base(model_name, use_4bit)
    named: list[tuple[str, Path]] = []
    if adapter is not None and adapter_exists(adapter):
        named.append(("default", adapter))
    if explain_adapter is not None and adapter_exists(explain_adapter):
        named.append(("explain", explain_adapter))
    model = attach_adapters(model, named)
    if named and named[0][0] == "explain":
        model.active = _BASE  # 주 어댑터 없이 해설만 있으면 기본은 베이스
    return model, tokenizer, {"main_adapter": any(n == "default" for n, _ in named),
                              "explain_adapter": any(n == "explain" for n, _ in named)}


def set_adapter(model: Any, name: str) -> None:
    if hasattr(model, "set_adapter"):
        try:
            model.set_adapter(name)
        except Exception as e:  # noqa: BLE001
            print(f"warn: set_adapter({name}) failed: {e}", file=sys.stderr)


def adapter_off(model: Any) -> Any:
    if hasattr(model, "disable_adapter"):
        return model.disable_adapter()
    return contextlib.nullcontext()


def is_cuda_oom(exc: BaseException) -> bool:
    """맥에는 VRAM 부족이 없다 — 통합 메모리가 모자라면 MLX 가 다른 예외를 낸다."""
    return False


def chat_text(
    model: Any,
    tokenizer: Any,
    system: str,
    user: str,
    *,
    max_tokens: int = 512,
    temp: float = 0.3,
    use_adapter: bool = True,
) -> str:
    from mlx_lm import generate
    from mlx_lm.sample_utils import make_sampler

    if SKIP_EXPLAIN and "해설만" in system:
        CALL_LOG.append({"step": "해설(건너뜀)", "model": "-", "sec": 0.0, "in": len(user), "out": 0, "max": max_tokens})
        return '{"Explanation": ""}'
    messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    t0 = time.time()
    ctx = contextlib.nullcontext() if use_adapter else adapter_off(model)
    with ctx:
        if isinstance(model, MlxModel):
            m, tok = model.current(), model.current_tokenizer() or tokenizer
        else:
            m, tok = model, tokenizer
        # Qwen3 계열은 기본으로 <think> 추론을 길게 쓴다 — JSON 한 개만 받는 단계라 끈다(다른 템플릿은 이 값을 무시)
        prompt = tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True, enable_thinking=False)
        out = generate(
            m,
            tok,
            prompt,
            max_tokens=max_tokens,
            sampler=make_sampler(temp=temp, top_p=0.9 if temp > 0 else 0.0),
            verbose=False,
        )
    if "</think>" in out:
        out = out.split("</think>", 1)[1]
    try:
        who = model._current_name() if isinstance(model, MlxModel) else "model"
    except Exception:  # noqa: BLE001
        who = "?"
    CALL_LOG.append({"step": " ".join(system.split())[:48], "model": who, "sec": round(time.time() - t0, 2),
                     "in": len(user), "out": len(out), "max": max_tokens})
    return out


def chat_json(
    model: Any,
    tokenizer: Any,
    system: str,
    user: str,
    *,
    max_tokens: int = 512,
    temp: float = 0.3,
    use_adapter: bool = True,
) -> dict | None:
    return extract_json_object(
        chat_text(model, tokenizer, system, user, max_tokens=max_tokens, temp=temp, use_adapter=use_adapter)
    )
