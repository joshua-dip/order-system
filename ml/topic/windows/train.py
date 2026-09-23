#!/usr/bin/env python3
"""Windows NVIDIA CUDA — 주제 유형 LoRA/QLoRA 학습.

Mac MLX 와 같은 data/topic-finetune/{train,valid}.jsonl (chat messages) 를 쓴다.
Claude/Anthropic API 없음.

  python train.py
  python train.py --model Qwen/Qwen2.5-7B-Instruct --epochs 1
  python train.py --model Qwen/Qwen2.5-0.5B-Instruct --no-4bit --max-steps 400 --max-seq-len 1024
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
DATA_DIR = ROOT / "data" / "topic-finetune"
DEFAULT_ADAPTER = Path(__file__).resolve().parent.parent / "adapters" / "topic-lora-cuda"


def main() -> int:
    ap = argparse.ArgumentParser(description="Topic variant LoRA train (Windows CUDA)")
    ap.add_argument(
        "--model",
        default="Qwen/Qwen2.5-7B-Instruct",
        help="HF 베이스 (24GB→7B 4bit, 12GB→3B, 4GB→0.5B --no-4bit)",
    )
    ap.add_argument("--data", type=Path, default=DATA_DIR)
    ap.add_argument("--adapter", type=Path, default=DEFAULT_ADAPTER)
    ap.add_argument("--epochs", type=float, default=1.0)
    ap.add_argument(
        "--max-steps",
        type=int,
        default=0,
        help=">0 이면 epochs 대신 스텝 수 제한 (스모크: 100~600)",
    )
    ap.add_argument("--batch-size", type=int, default=1)
    ap.add_argument("--grad-accum", type=int, default=8)
    ap.add_argument("--lr", type=float, default=1e-4)
    ap.add_argument("--lora-r", type=int, default=16)
    ap.add_argument("--lora-alpha", type=int, default=32)
    ap.add_argument("--max-seq-len", type=int, default=2048)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument(
        "--no-4bit",
        action="store_true",
        help="bitsandbytes 4bit 끄기 (Pascal/4GB GPU: GTX 1050 Ti 등)",
    )
    ap.add_argument(
        "--low-vram",
        action="store_true",
        help="4GB급 프리셋: 0.5B + --no-4bit + seq 1024 (모델 미지정 시)",
    )
    args = ap.parse_args()

    if args.low_vram:
        if args.model == "Qwen/Qwen2.5-7B-Instruct":
            args.model = "Qwen/Qwen2.5-0.5B-Instruct"
        args.no_4bit = True
        if args.max_seq_len >= 2048:
            args.max_seq_len = 1024
        if args.max_steps <= 0:
            args.max_steps = 400
        if args.lora_r > 8:
            args.lora_r = 8
            args.lora_alpha = 16

    train_path = args.data / "train.jsonl"
    valid_path = args.data / "valid.jsonl"
    if not train_path.is_file():
        print(
            f"train.jsonl 없음: {train_path}\n먼저: npm run cc:topic-export",
            file=sys.stderr,
        )
        return 1

    train_n = sum(1 for _ in train_path.open(encoding="utf-8") if _.strip())
    if train_n < 10:
        print(f"train.jsonl 이 {train_n}줄뿐이라 중단합니다.", file=sys.stderr)
        return 1

    try:
        import torch
        from datasets import load_dataset
        from peft import LoraConfig
        from transformers import AutoModelForCausalLM, AutoTokenizer
        from trl import SFTConfig, SFTTrainer
    except ImportError as e:
        print(
            f"의존성 없음: {e}\n"
            "ml\\topic\\windows\\setup.bat 을 먼저 실행하세요.",
            file=sys.stderr,
        )
        return 1

    if not torch.cuda.is_available():
        print(
            "CUDA GPU 가 없습니다. nvidia-smi 로 드라이버를 확인하세요.\n"
            "CPU 학습은 지원하지 않습니다.",
            file=sys.stderr,
        )
        return 1

    props = torch.cuda.get_device_properties(0)
    vram_gb = props.total_memory / 1e9
    cc = f"{props.major}.{props.minor}"
    print(f"GPU={torch.cuda.get_device_name(0)} VRAM≈{vram_gb:.1f}GB CC={cc}")
    print(
        f"model={args.model} train_n={train_n} adapter={args.adapter} "
        f"4bit={not args.no_4bit} seq={args.max_seq_len}"
    )

    if vram_gb < 6 and not args.no_4bit and "0.5B" not in args.model and "1.5B" not in args.model:
        print(
            "경고: VRAM이 매우 작습니다. Ctrl+C 후 "
            "`python train.py --low-vram` 또는 run_all.ps1 -LowVram 을 권장합니다.",
            file=sys.stderr,
        )

    dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
    load_kwargs: dict = {
        "trust_remote_code": True,
        "torch_dtype": dtype,
        "device_map": "auto",
    }

    if not args.no_4bit:
        try:
            from transformers import BitsAndBytesConfig
        except ImportError:
            print("BitsAndBytesConfig 없음 — --no-4bit 로 재시도하세요.", file=sys.stderr)
            return 1
        load_kwargs["quantization_config"] = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=dtype,
            bnb_4bit_use_double_quant=True,
        )

    tokenizer = AutoTokenizer.from_pretrained(args.model, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = "right"

    model = AutoModelForCausalLM.from_pretrained(args.model, **load_kwargs)
    model.config.use_cache = False

    target_modules = [
        "q_proj",
        "k_proj",
        "v_proj",
        "o_proj",
        "gate_proj",
        "up_proj",
        "down_proj",
    ]
    peft_config = LoraConfig(
        r=args.lora_r,
        lora_alpha=args.lora_alpha,
        lora_dropout=0.05,
        bias="none",
        task_type="CAUSAL_LM",
        target_modules=target_modules,
    )

    data_files = {"train": str(train_path)}
    if valid_path.is_file():
        data_files["validation"] = str(valid_path)
    raw = load_dataset("json", data_files=data_files)

    def to_text(example: dict) -> dict:
        messages = example["messages"]
        text = tokenizer.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=False,
        )
        return {"text": text}

    ds = raw.map(to_text, remove_columns=raw["train"].column_names)

    args.adapter.mkdir(parents=True, exist_ok=True)
    max_steps = args.max_steps if args.max_steps > 0 else -1
    eval_ds = ds.get("validation")
    has_eval = eval_ds is not None and len(eval_ds) > 0

    # 4bit+bnb 없으면 일반 adamw
    optim = "adamw_torch" if args.no_4bit else "paged_adamw_8bit"

    sft_kwargs: dict = {
        "output_dir": str(args.adapter / "checkpoints"),
        "num_train_epochs": args.epochs if max_steps < 0 else 1.0,
        "max_steps": max_steps,
        "per_device_train_batch_size": args.batch_size,
        "gradient_accumulation_steps": args.grad_accum,
        "learning_rate": args.lr,
        "logging_steps": 10,
        "save_steps": 200,
        "save_total_limit": 2,
        "bf16": torch.cuda.is_bf16_supported(),
        "fp16": not torch.cuda.is_bf16_supported(),
        "optim": optim,
        "lr_scheduler_type": "cosine",
        "warmup_ratio": 0.03,
        "report_to": "none",
        "seed": args.seed,
        "dataset_text_field": "text",
        "packing": False,
        "gradient_checkpointing": True,
        "gradient_checkpointing_kwargs": {"use_reentrant": False},
        "max_seq_length": args.max_seq_len,
    }
    if has_eval:
        sft_kwargs["eval_strategy"] = "steps"
        sft_kwargs["eval_steps"] = 200

    # TRL / transformers 버전마다 인자 이름이 다름 — 모르는 키는 빼고 재시도
    alias = {
        "max_seq_length": "max_length",
        "warmup_ratio": "warmup_steps",
    }
    sft_args = None
    last_err: Exception | None = None
    for _ in range(12):
        try:
            sft_args = SFTConfig(**sft_kwargs)
            break
        except TypeError as e:
            last_err = e
            msg = str(e)
            # unexpected keyword argument 'foo'
            key = None
            if "unexpected keyword argument" in msg:
                key = msg.rsplit("'", 2)[-2] if "'" in msg else None
            if not key:
                # try aliases once
                changed = False
                for old, new in list(alias.items()):
                    if old in sft_kwargs:
                        val = sft_kwargs.pop(old)
                        if new == "warmup_steps" and isinstance(val, float) and val < 1:
                            # ratio -> rough step count
                            sft_kwargs[new] = max(1, int(100 * val)) if max_steps < 0 else max(1, int(max_steps * val))
                        else:
                            sft_kwargs[new] = val
                        changed = True
                if changed:
                    continue
                raise
            sft_kwargs.pop(key, None)
            if key == "max_seq_length":
                sft_kwargs.setdefault("max_length", args.max_seq_len)
            if key == "warmup_ratio":
                sft_kwargs.setdefault(
                    "warmup_steps",
                    max(1, int(max_steps * 0.03)) if max_steps > 0 else 10,
                )
    if sft_args is None:
        raise last_err or RuntimeError("SFTConfig failed")

    trainer_kwargs: dict = {
        "model": model,
        "args": sft_args,
        "train_dataset": ds["train"],
        "eval_dataset": eval_ds if has_eval else None,
        "peft_config": peft_config,
    }
    try:
        trainer = SFTTrainer(processing_class=tokenizer, **trainer_kwargs)
    except TypeError:
        trainer = SFTTrainer(tokenizer=tokenizer, **trainer_kwargs)

    trainer.train()
    trainer.model.save_pretrained(str(args.adapter))
    tokenizer.save_pretrained(str(args.adapter))

    meta = {
        "base_model": args.model,
        "train_n": train_n,
        "epochs": args.epochs,
        "max_steps": args.max_steps,
        "lora_r": args.lora_r,
        "lora_alpha": args.lora_alpha,
        "no_4bit": args.no_4bit,
        "max_seq_len": args.max_seq_len,
        "backend": "windows-cuda-lora" if args.no_4bit else "windows-cuda-qlora",
    }
    (args.adapter / "train_meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"done → {args.adapter}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
