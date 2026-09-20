#!/usr/bin/env python3
"""Windows CUDA 주제 LoRA 추론: 지문 → question_data JSON (stdout). Claude/API 없음.

Mac ml/topic/infer.py 와 동일한 stdout 계약:
  첫 줄 JSON { ok, question_data } + (옵션) 시험지 미리보기
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# 상위 ml/topic 을 import path 에
_TOPIC_DIR = Path(__file__).resolve().parent.parent
if str(_TOPIC_DIR) not in sys.path:
    sys.path.insert(0, str(_TOPIC_DIR))

from _topic_common import (  # noqa: E402
    SYSTEM_PROMPT,
    extract_json_object,
    format_exam_view,
    read_passage_interactive,
)

DEFAULT_ADAPTER = _TOPIC_DIR / "adapters" / "topic-lora-cuda"
DEFAULT_MODEL = "Qwen/Qwen2.5-7B-Instruct"


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


def main() -> int:
    ap = argparse.ArgumentParser(description="Local topic-variant infer (Windows CUDA LoRA)")
    ap.add_argument("--model", default="", help="비우면 adapter train_meta / 기본 Qwen 7B")
    ap.add_argument("--adapter", default=str(DEFAULT_ADAPTER))
    ap.add_argument("--passage-file", help="지문 텍스트 파일")
    ap.add_argument(
        "--paste",
        action="store_true",
        help="터미널에 지문 붙여넣기 (끝: Ctrl-Z Enter 또는 END)",
    )
    ap.add_argument("--max-tokens", type=int, default=4096)
    ap.add_argument("--temp", type=float, default=0.3)
    ap.add_argument(
        "--json-only",
        action="store_true",
        help="기계 파싱용 — JSON 한 줄만 출력",
    )
    ap.add_argument(
        "--no-4bit",
        action="store_true",
        help="4bit 끄기 (GTX 1050 Ti 등 Pascal / 저용량 VRAM)",
    )
    args = ap.parse_args()

    if args.passage_file:
        passage = Path(args.passage_file).read_text(encoding="utf-8").strip()
    elif args.paste or sys.stdin.isatty():
        passage = read_passage_interactive()
    else:
        passage = sys.stdin.read().strip()
    if not passage:
        print("지문이 비어 있습니다.", file=sys.stderr)
        return 1

    adapter_path = Path(args.adapter)
    has_adapter = adapter_path.is_dir() and (
        (adapter_path / "adapter_config.json").is_file()
        or (adapter_path / "adapter_model.safetensors").is_file()
        or any(adapter_path.glob("adapter_model*.safetensors"))
    )
    model_name = (args.model or "").strip() or load_base_model_name(
        adapter_path if has_adapter else Path("."), DEFAULT_MODEL
    )

    # train_meta 에 no_4bit 있으면 추론도 맞춤
    use_4bit = not args.no_4bit
    if has_adapter and (adapter_path / "train_meta.json").is_file():
        try:
            meta = json.loads((adapter_path / "train_meta.json").read_text(encoding="utf-8"))
            if meta.get("no_4bit"):
                use_4bit = False
        except (json.JSONDecodeError, OSError):
            pass

    print(f"지문 {len(passage)}자 — CUDA 모델 로딩·생성 중… (4bit={use_4bit})", file=sys.stderr)
    try:
        import torch
        from peft import PeftModel
        from transformers import AutoModelForCausalLM, AutoTokenizer
    except ImportError:
        print(
            "transformers/peft 없음. ml\\topic\\windows\\setup.bat 을 실행하세요.",
            file=sys.stderr,
        )
        return 1

    if not torch.cuda.is_available():
        print("CUDA GPU 없음 — nvidia-smi 확인.", file=sys.stderr)
        return 1

    dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
    load_kwargs: dict = {
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
    if has_adapter:
        model = PeftModel.from_pretrained(model, str(adapter_path))
    else:
        print(f"경고: adapter 없음 ({adapter_path}) — 베이스 모델만 사용", file=sys.stderr)

    model.eval()

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": f"[지문 Paragraph]\n{passage}"},
    ]
    prompt = tokenizer.apply_chat_template(
        messages, tokenize=False, add_generation_prompt=True
    )
    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)

    with torch.no_grad():
        out = model.generate(
            **inputs,
            max_new_tokens=args.max_tokens,
            do_sample=args.temp > 0,
            temperature=max(args.temp, 1e-5) if args.temp > 0 else None,
            top_p=0.9 if args.temp > 0 else None,
            pad_token_id=tokenizer.pad_token_id,
            eos_token_id=tokenizer.eos_token_id,
        )
    gen = out[0][inputs["input_ids"].shape[-1] :]
    text = tokenizer.decode(gen, skip_special_tokens=True)

    parsed = extract_json_object(text)
    if not parsed:
        print(
            json.dumps(
                {"ok": False, "error": "JSON 파싱 실패", "raw": text[:2000]},
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
