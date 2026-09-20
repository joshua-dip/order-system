#!/usr/bin/env python3
"""Windows NVIDIA CUDA — 주제 유형 QLoRA 학습.

Mac MLX 와 같은 data/topic-finetune/{train,valid}.jsonl (chat messages) 를 쓴다.
Claude/Anthropic API 없음.

  python train.py
  python train.py --model Qwen/Qwen2.5-7B-Instruct --epochs 1
  python train.py --model Qwen/Qwen2.5-3B-Instruct --max-steps 600
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
    ap = argparse.ArgumentParser(description="Topic variant QLoRA train (Windows CUDA)")
    ap.add_argument(
        "--model",
        default="Qwen/Qwen2.5-7B-Instruct",
        help="HF 베이스 모델 (VRAM 24GB면 7B 4bit 권장, 12GB면 3B)",
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
    args = ap.parse_args()

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
        from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
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

    print(
        f"GPU={torch.cuda.get_device_name(0)} "
        f"VRAM≈{torch.cuda.get_device_properties(0).total_memory / 1e9:.1f}GB"
    )
    print(f"model={args.model} train_n={train_n} adapter={args.adapter}")

    bnb = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.bfloat16
        if torch.cuda.is_bf16_supported()
        else torch.float16,
        bnb_4bit_use_double_quant=True,
    )

    tokenizer = AutoTokenizer.from_pretrained(args.model, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = "right"

    model = AutoModelForCausalLM.from_pretrained(
        args.model,
        quantization_config=bnb,
        device_map="auto",
        trust_remote_code=True,
        torch_dtype=torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16,
    )
    model.config.use_cache = False

    # Qwen / Llama 공통으로 자주 쓰는 모듈
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
        # assistant 응답에만 손실 — chat template + generation prompt 로 train text 구성
        text = tokenizer.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=False,
        )
        return {"text": text}

    ds = raw.map(to_text, remove_columns=raw["train"].column_names)

    args.adapter.mkdir(parents=True, exist_ok=True)
    max_steps = args.max_steps if args.max_steps > 0 else -1

    sft_args = SFTConfig(
        output_dir=str(args.adapter / "checkpoints"),
        num_train_epochs=args.epochs if max_steps < 0 else 1.0,
        max_steps=max_steps,
        per_device_train_batch_size=args.batch_size,
        gradient_accumulation_steps=args.grad_accum,
        learning_rate=args.lr,
        logging_steps=10,
        save_steps=200,
        save_total_limit=2,
        bf16=torch.cuda.is_bf16_supported(),
        fp16=not torch.cuda.is_bf16_supported(),
        optim="paged_adamw_8bit",
        lr_scheduler_type="cosine",
        warmup_ratio=0.03,
        report_to="none",
        seed=args.seed,
        max_seq_length=args.max_seq_len,
        dataset_text_field="text",
        packing=False,
        gradient_checkpointing=True,
        gradient_checkpointing_kwargs={"use_reentrant": False},
    )

    eval_ds = ds.get("validation")
    trainer = SFTTrainer(
        model=model,
        args=sft_args,
        train_dataset=ds["train"],
        eval_dataset=eval_ds,
        processing_class=tokenizer,
        peft_config=peft_config,
    )

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
        "backend": "windows-cuda-qlora",
    }
    (args.adapter / "train_meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"done → {args.adapter}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
