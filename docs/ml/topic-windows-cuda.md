# 주제 유형 — Windows + NVIDIA CUDA QLoRA

Mac MLX 실험(`docs/ml/topic-local-ai.md`)을 **Windows GPU** 로 키우는 가이드다.  
데이터·검증·저장 계약은 Mac과 **동일**하다. Claude/Anthropic API 는 쓰지 않는다.

```
npm run cc:topic-export          # 같은 train.jsonl
        ↓
ml/topic/windows/train.py        # QLoRA (bitsandbytes 4bit)
        ↓
adapters/topic-lora-cuda/
        ↓
infer.py → prevalidate → (옵션) DB 저장  (ai_source=local-topic-lora)
```

---

## 1. 준비물

| 항목 | 권장 |
|------|------|
| OS | Windows 10/11 |
| GPU | NVIDIA **VRAM 12GB+** (3B), **24GB+** (7B QLoRA) |
| 드라이버 | 최신 Game Ready / Studio + `nvidia-smi` 동작 |
| Python | **3.11 또는 3.12** (PATH 등록, “Install launcher” OK) |
| Node | 기존 next-order 와 동일 (`npm` 로 export·cc-topic-local) |
| 디스크 | 모델 캐시 ~15–20GB (Hugging Face `~/.cache/huggingface`) |

VRAM이 부족하면 기본 7B 대신 **`Qwen/Qwen2.5-3B-Instruct`** 로 학습한다.

---

## 2. 최초 세팅 (한 번)

저장소를 clone/pull 한 뒤:

```bat
cd ml\topic\windows
setup.bat
```

하는 일:

1. `.venv` 생성  
2. **PyTorch CUDA 12.4** wheel 설치  
3. `transformers` / `peft` / `trl` / `bitsandbytes` 설치  
4. `torch.cuda.is_available()` 확인 출력  

`cuda= False` 이면:

- `nvidia-smi` 가 되는지  
- PyTorch CUDA 버전이 드라이버와 맞는지 ([pytorch.org](https://pytorch.org) 에서 cu121 등으로 재설치)

---

## 3. 데이터 export (Mac과 동일)

프로젝트 루트 (`.env` / `.env.local` 에 `MONGODB_URI`):

```bat
npm run cc:topic-export
```

성공 시 `data/topic-finetune/train.jsonl`, `valid.jsonl`, `meta.json`.  
Mac에서 export 한 폴더를 USB/공유로 복사해도 된다 (형식 동일).

---

## 4. 학습

```bat
cd ml\topic\windows

REM 기본: Qwen2.5-7B-Instruct, 1 epoch
train.bat

REM 스모크 (빠르게 파이프만 확인)
train.bat Qwen/Qwen2.5-3B-Instruct 100

REM 본학습에 가까운 스텝 제한
train.bat Qwen/Qwen2.5-7B-Instruct 600
```

또는:

```bat
.venv\Scripts\activate
python train.py --model Qwen/Qwen2.5-7B-Instruct --epochs 1
python train.py --model Qwen/Qwen2.5-3B-Instruct --max-steps 600 --batch-size 1 --grad-accum 8
```

산출물:

- `ml/topic/adapters/topic-lora-cuda/` — LoRA 가중치  
- `train_meta.json` — 베이스 모델명·하이퍼파라미터 (추론이 읽음)

학습 옵션 요지:

- 4bit NF4 + LoRA (`r=16`)  
- `gradient_checkpointing`  
- chat template 로 `messages` → `text` 변환 (Mac JSONL 그대로)

---

## 5. 추론

### 터미널에 지문 붙여넣기

```bat
cd ml\topic\windows
ask.bat
```

1. 영어 지문 붙여넣기  
2. 끝: **Ctrl-Z 후 Enter**, 또는 마지막 줄 **`END`**  
3. 첫 줄 JSON + 시험지 미리보기  

```bat
ask.bat --json-only
.venv\Scripts\python.exe infer.py --passage-file C:\temp\p.txt
```

### 앱 CLI (prevalidate / 저장)

```bat
REM 저장소 루트 — Windows 어댑터 자동 선택
set TOPIC_BACKEND=cuda
npm run cc:topic-local -- --passage-id <ObjectId>

npm run cc:topic-local -- --backend cuda --passage-id <ObjectId> --save
```

`ai_source` 는 Mac과 같이 **`local-topic-lora`**.

`TOPIC_CUDA_VENV` 로 venv 경로를 지정할 수 있다 (기본: `ml/topic/windows/.venv`).

---

## 6. Mac MLX 와의 차이

| | Mac MLX | Windows CUDA |
|--|---------|----------------|
| 라이브러리 | `mlx-lm` | `transformers` + `peft` + `bitsandbytes` |
| 기본 모델 | Llama-3.2-3B 4bit (MLX) | Qwen2.5-7B Instruct (HF 4bit) |
| 어댑터 경로 | `adapters/topic-lora/` | `adapters/topic-lora-cuda/` |
| 학습 스크립트 | `ml/topic/train.sh` | `ml/topic/windows/train.bat` |
| 호환 | MLX 어댑터 ↔ HF 어댑터 **서로 안 맞음** | 같은 JSONL만 공유 |

한쪽에서 학습한 가중치를 다른쪽에 그대로 옮기지 않는다.  
데이터와 `prevalidate` / `save` 계약만 맞춘다.

---

## 7. 권장 진행 순서

0. [ ] (선택) GPU 없이 골격만: `python smoke_check.py`  
1. [ ] `setup.bat` → `cuda=True` 확인  
2. [ ] `npm run cc:topic-export`  
3. [ ] `train.bat … 100` 스모크 → `ask.bat` 로 JSON 골격 확인  
4. [ ] `train.bat` 1 epoch 또는 `--max-steps 600~2000`  
5. [ ] valid 지문 20개: JSON parse율 / `cc:topic-local` prevalidate 통과율  
6. [ ] 품질 부족 시 7B 유지 + steps↑, 또는 더 큰 VRAM에서 14B 검토  

---

## 8. 치트시트

```bat
cd ml\topic\windows
setup.bat

cd ..\..\..
npm run cc:topic-export

cd ml\topic\windows
train.bat Qwen/Qwen2.5-7B-Instruct 600
ask.bat

cd ..\..\..
set TOPIC_BACKEND=cuda
npm run cc:topic-local -- --passage-id <ObjectId>
```

---

## 9. 관련 문서

- Mac 실험 노트: [`topic-local-ai.md`](./topic-local-ai.md)  
- Windows 치트시트: [`ml/topic/windows/README.md`](../../ml/topic/windows/README.md)  
- 주제 출제 규칙: [`docs/variant/AUTHORING.md`](../variant/AUTHORING.md)
