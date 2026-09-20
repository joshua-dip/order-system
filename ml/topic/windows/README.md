# 주제 유형 — Windows CUDA QLoRA (짧은 치트시트)

```bat
REM 0) (선택) GPU 없이 파일·JSON 복구만 확인
python smoke_check.py

REM 1) 최초 1회
setup.bat

REM 2) 저장소 루트 (PowerShell/CMD)
cd ..\..\..
npm run cc:topic-export

REM 3) 학습 (VRAM 24GB+ → 7B, 12GB → 3B)
cd ml\topic\windows
train.bat
train.bat Qwen/Qwen2.5-3B-Instruct 600

REM 4) 지문 붙여넣기 추론
ask.bat
```

자세한 가이드: **[docs/ml/topic-windows-cuda.md](../../../docs/ml/topic-windows-cuda.md)**

Mac MLX 실험과 **같은 JSONL** (`data/topic-finetune/`) 을 씁니다.  
어댑터는 `ml/topic/adapters/topic-lora-cuda/` 에 저장됩니다.
