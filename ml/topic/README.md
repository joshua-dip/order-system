# 주제 유형 — Mac MLX LoRA (짧은 치트시트)

```bash
# 터미널에 지문 붙여넣기 (끝: Ctrl-D 또는 마지막 줄 END)
./ask.sh
# 또는
/tmp/topic-mlx-venv/bin/python infer.py --paste
```

지문 **중간 빈 줄**이 있어도 잘리지 않습니다. (예전 ‘빈 줄 두 번 종료’는 제거함)

자세한 공부용 정리:

→ **[docs/ml/topic-local-ai.md](../../docs/ml/topic-local-ai.md)**

## 그 외 명령

```bash
# 데이터 (MongoDB → JSONL)
npm run cc:topic-export

# Python (이 Mac에서는 /tmp venv 권장)
python3 -m venv /tmp/topic-mlx-venv
/tmp/topic-mlx-venv/bin/pip install -r requirements.txt
export TOPIC_MLX_VENV=/tmp/topic-mlx-venv

# 학습
./train.sh mlx-community/Llama-3.2-3B-Instruct-4bit 600

# 파일/ID
/tmp/topic-mlx-venv/bin/python infer.py --passage-file /tmp/p.txt
cd ../.. && npm run cc:topic-local -- --passage-id <ObjectId>
```

Claude/Anthropic 는 쓰지 않는다. Apple Silicon + MLX + 우리 DB 주제 문항만 사용한다.
