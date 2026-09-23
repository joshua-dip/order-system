"""Windows CUDA 공용 런타임 — 모델 로드·어댑터·생성. 주제·제목·주장과 워커가 모두 이 모듈을 쓴다.

유형별 ml/<type>/windows/_cuda_runtime.py 는 경로 상수만 두고 여기 함수를 다시 내보낸다.
한 프로세스(워커)에서 세 파이프라인을 불러도 로드·생성 코드가 한 벌뿐이게 하려는 것.
torch/transformers 는 함수 안에서만 import 한다 — 모듈 import 만으로 CUDA 를 건드리지 않게.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

_COMMON = Path(__file__).resolve().parent
if str(_COMMON) not in sys.path:
    sys.path.insert(0, str(_COMMON))

from json_extract import extract_json_object  # noqa: E402


def load_base_model_name(adapter: Path, fallback: str) -> str:
    meta = adapter / "train_meta.json"
    if meta.is_file():
        try:
            data = json.loads(meta.read_text(encoding="utf-8"))
            name = data.get("base_model")
            if isinstance(name, str) and name.strip():
                return name.strip()
        except (json.JSONDecodeError, OSError):
            pass
    cfg = adapter / "adapter_config.json"
    if cfg.is_file():
        try:
            data = json.loads(cfg.read_text(encoding="utf-8"))
            name = data.get("base_model_name_or_path")
            if isinstance(name, str) and name.strip():
                return name.strip()
        except (json.JSONDecodeError, OSError):
            pass
    return fallback


def adapter_exists(adapter: Path) -> bool:
    if not adapter.is_dir():
        return False
    if (adapter / "adapter_config.json").is_file():
        return True
    if (adapter / "adapter_model.safetensors").is_file():
        return True
    return any(adapter.glob("adapter_model*.safetensors"))


def resolve_use_4bit(adapter: Path, no_4bit_flag: bool) -> bool:
    if no_4bit_flag:
        return False
    meta = adapter / "train_meta.json"
    if meta.is_file():
        try:
            data = json.loads(meta.read_text(encoding="utf-8"))
            if data.get("no_4bit"):
                return False
        except (json.JSONDecodeError, OSError):
            pass
    return True


def load_base(model_name: str, use_4bit: bool) -> tuple[Any, Any]:
    """HF causal LM 베이스(어댑터 없음) + 토크나이저."""
    try:
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer
    except ImportError as e:
        raise RuntimeError(
            f"transformers/peft 없음 ({e}) — ml\\topic\\windows\\setup.bat 으로 venv 를 먼저 만드세요(세 유형 공용)."
        ) from e

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA GPU not available — check nvidia-smi")

    dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
    load_kwargs: dict[str, Any] = {
        "trust_remote_code": True,
        "torch_dtype": dtype,
        "device_map": "auto",
    }
    if use_4bit:
        from transformers import BitsAndBytesConfig

        load_kwargs["quantization_config"] = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=dtype,
            bnb_4bit_use_double_quant=True,
        )

    tokenizer = AutoTokenizer.from_pretrained(model_name, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    model = AutoModelForCausalLM.from_pretrained(model_name, **load_kwargs)
    return model, tokenizer


def attach_adapters(model: Any, adapters: list[tuple[str, Path]]) -> Any:
    """이름 붙인 LoRA 어댑터 여러 개를 한 베이스에 붙인다. 이후 set_adapter(model, 이름)으로 전환."""
    if not adapters:
        return model
    from peft import PeftModel

    first_name, first_path = adapters[0]
    model = PeftModel.from_pretrained(model, str(first_path), adapter_name=first_name)
    for name, path in adapters[1:]:
        model.load_adapter(str(path), adapter_name=name)
    model.eval()
    return model


def load_model(
    model_name: str,
    adapter: Path | None,
    use_4bit: bool,
    explain_adapter: Path | None = None,
) -> tuple[Any, Any, dict[str, bool]]:
    """단독 CLI(infer.py·pipeline_*.py)용 — 주 어댑터는 "default", 해설 어댑터는 "explain" 이름으로."""
    model, tokenizer = load_base(model_name, use_4bit)
    flags = {"main_adapter": False, "explain_adapter": False}

    named: list[tuple[str, Path]] = []
    if adapter is not None and adapter_exists(adapter):
        named.append(("default", adapter))
        flags["main_adapter"] = True
    elif adapter is not None:
        print(f"warn: adapter missing ({adapter}) — base model only", file=sys.stderr)
    if named:
        model = attach_adapters(model, named)

    if explain_adapter is not None and adapter_exists(explain_adapter):
        try:
            if flags["main_adapter"]:
                model.load_adapter(str(explain_adapter), adapter_name="explain")
            else:
                model = attach_adapters(model, [("explain", explain_adapter)])
            flags["explain_adapter"] = True
            print(f"loaded explain adapter: {explain_adapter}", file=sys.stderr)
        except Exception as e:
            print(f"warn: explain adapter load failed: {e}", file=sys.stderr)

    model.eval()
    return model, tokenizer, flags


def set_adapter(model: Any, name: str) -> None:
    if hasattr(model, "set_adapter"):
        try:
            model.set_adapter(name)
        except Exception as e:
            print(f"warn: set_adapter({name}) failed: {e}", file=sys.stderr)


def is_cuda_oom(exc: BaseException) -> bool:
    try:
        import torch

        if isinstance(exc, torch.cuda.OutOfMemoryError):
            return True
    except ImportError:
        pass
    return "out of memory" in str(exc).lower()


def chat_text(
    model: Any,
    tokenizer: Any,
    system: str,
    user: str,
    *,
    max_tokens: int = 512,
    temp: float = 0.3,
) -> str:
    import torch

    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)
    with torch.no_grad():
        out = model.generate(
            **inputs,
            max_new_tokens=max_tokens,
            do_sample=temp > 0,
            temperature=max(temp, 1e-5) if temp > 0 else None,
            top_p=0.9 if temp > 0 else None,
            pad_token_id=tokenizer.pad_token_id,
            eos_token_id=tokenizer.eos_token_id,
        )
    gen = out[0][inputs["input_ids"].shape[-1] :]
    return tokenizer.decode(gen, skip_special_tokens=True)


def chat_json(
    model: Any,
    tokenizer: Any,
    system: str,
    user: str,
    *,
    max_tokens: int = 512,
    temp: float = 0.3,
) -> dict | None:
    return extract_json_object(chat_text(model, tokenizer, system, user, max_tokens=max_tokens, temp=temp))
