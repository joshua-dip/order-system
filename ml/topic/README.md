# 주제 유형 — 로컬 LoRA (치트시트)

## Mac (MLX)

```bash
./ask.sh
# 학습: ./train.sh
# 문서: docs/ml/topic-local-ai.md
```

## Windows (NVIDIA CUDA)

```bat
cd windows
setup.bat
train.bat
ask.bat
```

문서: **[docs/ml/topic-windows-cuda.md](../../docs/ml/topic-windows-cuda.md)** · 치트시트 `windows/README.md`

---

데이터 export (공통):

```bash
npm run cc:topic-export
```

Claude/Anthropic 는 쓰지 않는다. DB 주제 문항 JSONL + 로컬 GPU만 사용한다.
