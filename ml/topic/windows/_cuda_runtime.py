"""Shared CUDA model load + chat generate for Windows topic LoRA."""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

_TOPIC_DIR = Path(__file__).resolve().parent.parent
if str(_TOPIC_DIR) not in sys.path:
    sys.path.insert(0, str(_TOPIC_DIR))

from _topic_common import extract_json_object  # noqa: E402

DEFAULT_ADAPTER = _TOPIC_DIR / "adapters" / "topic-lora-cuda"
DEFAULT_EXPLAIN_ADAPTER = _TOPIC_DIR / "adapters" / "topic-explain-lora-cuda"
DEFAULT_MODEL = "Qwen/Qwen2.5-7B-Instruct"


def load_base_model_name(adapter: Path, fallback: str = DEFAULT_MODEL) -> str:
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


def load_model(
    model_name: str,
    adapter: Path | None,
    use_4bit: bool,
    explain_adapter: Path | None = None,
) -> tuple[Any, Any, dict[str, bool]]:
    """Load HF causal LM (+ optional PEFT). Returns (model, tokenizer, flags)."""
    try:
        import torch
        from peft import PeftModel
        from transformers import AutoModelForCausalLM, AutoTokenizer
    except ImportError as e:
        raise RuntimeError(
            f"transformers/peft missing ({e}). Run ml\\topic\\windows\\setup.bat"
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
    flags = {"main_adapter": False, "explain_adapter": False}

    if adapter is not None and adapter_exists(adapter):
        model = PeftModel.from_pretrained(model, str(adapter))
        flags["main_adapter"] = True
    elif adapter is not None:
        print(f"warn: adapter missing ({adapter}) — base model only", file=sys.stderr)

    if explain_adapter is not None and adapter_exists(explain_adapter):
        try:
            if flags["main_adapter"]:
                model.load_adapter(str(explain_adapter), adapter_name="explain")
            else:
                model = PeftModel.from_pretrained(
                    model, str(explain_adapter), adapter_name="explain"
                )
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
    prompt = tokenizer.apply_chat_template(
        messages, tokenize=False, add_generation_prompt=True
    )
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
    text = chat_text(
        model, tokenizer, system, user, max_tokens=max_tokens, temp=temp
    )
    return extract_json_object(text)
