# 주제 유형 — 자체 모델 실험 가이드 (Mac MLX)

이 문서는 **클로드/Anthropic API 없이**, DB에 있는 주제 문항으로 오픈모델을 파인튜닝해  
「영어 지문 → 주제 `question_data` JSON」을 만드는 **실험 파이프라인**을 정리한 공부용 노트다.

> 목표 수준: **실험·학습**. 주문 납품용 품질 대체는 아직 아님.  
> 서비스급은 보통 **Windows + NVIDIA(VRAM 24GB+)** 또는 **Mac 64GB+** 에서 더 큰 모델로 이어간다.

---

## 1. 한 줄로 이해하기

```
우리 DB의 「주제」 문항(정답 JSON)
        ↓ export
  train.jsonl / valid.jsonl
        ↓ Mac MLX LoRA
  adapters/topic-lora (우리 가중치 조각)
        ↓ infer
  question_data JSON → prevalidate → (선택) DB 저장
```

**「AI를 직접 만든다」** = 가중치를 0부터 학습하는 것이 아니다.  
이미 있는 **오픈 베이스 모델**에, 우리 데이터로 **LoRA 어댑터**를 붙이는 것이다.  
그게 현실적인 “우리 모델”이다.

---

## 2. 왜 이렇게 했나 (결정 로그)

| 질문 | 결론 |
|------|------|
| 랭체인 필요? | **아니요.** 주제 1유형은 프롬프트→생성→JSON→검증이면 충분. |
| 클로드 API로 감싸기? | **안 함.** “직접 모델”이 목표라 API 초안 생성 경로와 분리. |
| 0부터 학습? | **불가에 가깝다.** 수조 토큰·거대 클러스터급. |
| 맥에서 가능? | **실험용 3B LoRA는 가능** (이 맥: M2 Pro 16GB). 서비스급은 빡셈. |
| 윈도우 vs 맥 | 학습 생태계·속도는 **NVIDIA CUDA(Windows/Linux)가 유리**. 맥은 실험·데모. |

### 랭체인을 안 쓴 이유

랭체인/LangGraph는 **여러 도구·체인·에이전트**를 오케스트레이션할 때 이득이다.  
지금은

1. 지문 넣기  
2. 모델이 JSON 한 개 내기  
3. 우리 `prevalidate`로 검사  

세 단계라 프레임워크 없이도 된다. 나중에 검색·DB 도구·다유형 라우팅이 생기면 그때 검토.

### 클로드 초안 API를 안 쓴 이유

저장소에는 이미 [`lib/admin-variant-draft-claude.ts`](../lib/admin-variant-draft-claude.ts) 로  
「지문+유형 → Claude JSON」경로가 있다. 그건 **기존 AI를 호출**하는 제품 기능이다.  
이번 실험은 **우리 데이터로 학습한 로컬 가중치**가 목표라 그 경로를 쓰지 않는다.

---

## 3. 스펙과 현실적인 기대

### 이 Mac (실험 당시)

- Apple **M2 Pro**, **16GB** 통합 메모리  
- Python 3.11 + **MLX** (Metal GPU)

| 할 일 | 가능? |
|-------|--------|
| 3B 4bit + LoRA 학습 | ✅ (peak ~6GB로 100 iter 성공) |
| 7B+ 여유 학습 | ⚠️ 빡셈 / OOM 위험 |
| from-scratch | ❌ |
| 납품 품질 바로 대체 | ❌ (형식 연습용에 가깝) |

### 서비스 후보를 자체 하드웨어로 가려면

- **최소**: GPU **VRAM 24GB+** (예: RTX 4090) **또는** Mac **64GB+**  
- 학습은 Windows+CUDA가 자료·도구가 많아 시행착오가 적음  
- 맥 실험 결과가 “형식은 되는데 품질이 약하다”면 → 윈도우에서 7B~14B로 스케일업

---

## 4. 디렉터리·파일 지도

```
next-order/
├── scripts/
│   ├── export-topic-finetune-jsonl.ts   # DB → JSONL
│   └── cc-topic-local.ts                # 추론 → prevalidate → (옵션) save
├── data/topic-finetune/                 # gitignore — 학습 데이터
│   ├── train.jsonl
│   ├── valid.jsonl
│   ├── test.jsonl
│   └── meta.json
├── ml/topic/
│   ├── README.md            # 짧은 치트시트 → docs/ml/topic-local-ai.md
│   ├── requirements.txt     # mlx-lm
│   ├── train.sh             # LoRA 학습
│   ├── infer.py             # 지문 → JSON
│   └── adapters/topic-lora/ # gitignore — 학습된 어댑터
├── docs/ml/
│   └── topic-local-ai.md    # 사용법 + 배경·공부용 정리 (본편)
└── package.json             # cc:topic-export, cc:topic-local
```

관련 기존 코드 (학습하지 않고 **규칙·검증**만 재사용):

- 주제 형식: [`docs/variant/AUTHORING.md`](../variant/AUTHORING.md)  
- 저장 전 검증: [`scripts/prevalidate-variants.ts`](../../scripts/prevalidate-variants.ts)  
- 지문 본문 추출: [`lib/passage-variant-text.ts`](../../lib/passage-variant-text.ts)  
- DB 저장: [`lib/variant-save-generated-question.ts`](../../lib/variant-save-generated-question.ts)

---

## 5. 데이터 형식 (공부 포인트)

MLX-LM **chat JSONL** — 한 줄이 한 샘플:

```json
{
  "messages": [
    { "role": "system", "content": "주제 출제 규칙…" },
    { "role": "user", "content": "[지문 Paragraph]\n(영어 원문)" },
    { "role": "assistant", "content": "{\"Question\":\"…\",\"Paragraph\":\"…\",\"Options\":\"① … ### ② …\",…}" }
  ]
}
```

- **system**: AUTHORING 요지 (Paragraph 원문 유지, Options 영어+`###`, 주제≠주장 …)  
- **user**: 지문만  
- **assistant**: 저장 가능한 `question_data` 핵심 키 JSON 문자열  

### 분할 방식

- `passage_id` 해시로 **train 90% / valid 10%**  
- 같은 지문이 train·valid에 **동시에 안 들어가게** (누수 방지)

### export 필터

- 기본: `type: 주제`, `status: 완료`  
- Options에 `###` 있고 CorrectAnswer 있는 것만  
- 첫 export 예: 완료 주제 **2,971건** (train 2,623 / valid 348).  
  `skippedEmptyQd`가 큰 것은 Options/`###` 없는 구형·불완전 문서가 많기 때문.

---

## 6. 사용법 (따라 하기)

### 6.1 데이터 export

프로젝트 루트 (`.env` / `.env.local`에 `MONGODB_URI`):

```bash
npm run cc:topic-export

# 대기 포함
npm run cc:topic-export -- --status all

# 주제-고난도 포함
npm run cc:topic-export -- --include-hard --status 완료

# 출력 위치
npm run cc:topic-export -- --out data/topic-finetune
```

성공 시 `data/topic-finetune/meta.json`에 건수가 찍힌다.

### 6.2 Python 환경 (Apple Silicon + MLX)

워크스페이스 안 `.venv` 생성이 막히는 환경이 있어, 이 Mac에서는 **/tmp** 를 썼다.

```bash
python3 -m venv /tmp/topic-mlx-venv
/tmp/topic-mlx-venv/bin/pip install -U pip
/tmp/topic-mlx-venv/bin/pip install -r ml/topic/requirements.txt
export TOPIC_MLX_VENV=/tmp/topic-mlx-venv
```

`train.sh` / `cc-topic-local` 은 `TOPIC_MLX_VENV` → `ml/topic/.venv` → `/tmp/topic-mlx-venv` 순으로 찾는다.

> Cursor 에이전트 샌드박스에서는 Metal GPU가 안 잡힐 수 있다.  
> **학습·추론은 로컬 터미널**에서 실행하는 것이 안전하다.

### 6.3 LoRA 학습

```bash
# 기본: Llama-3.2-3B-Instruct-4bit, 600 iter
./ml/topic/train.sh

# 실험용 짧게
./ml/topic/train.sh mlx-community/Llama-3.2-3B-Instruct-4bit 100

# 모델·iter 지정
./ml/topic/train.sh mlx-community/Qwen2.5-3B-Instruct-4bit 400
```

산출물:

- `ml/topic/adapters/topic-lora/adapters.safetensors`  
- `adapter_config.json`

학습 옵션 요지 (`train.sh` 안):

- `--mask-prompt` — 손실을 **assistant 응답** 쪽에 집중  
- `--batch-size 1` — 16GB 맥 기준  
- `--fine-tune-type lora`

### 6.4 추론 (터미널에 지문 붙여넣기)

```bash
cd /Users/goshua/next-order/ml/topic
./ask.sh
```

1. 안내가 나오면 **영어 지문을 붙여넣기**  
2. 끝낼 때 **Ctrl-D**, 또는 맨 마지막 줄에 **`END`** 만 치고 Enter  
3. stdout에 **JSON 한 줄** + 그 아래 **시험지 형식** 미리보기  
   - JSON만 필요하면: `./ask.sh --json-only`

> 예전에 ‘빈 줄 두 번’으로 끝내던 방식은 **지문 중간 빈 줄에서 잘려** 제거했다.

동일:

```bash
/tmp/topic-mlx-venv/bin/python ml/topic/infer.py --paste
```

파일·파이프도 가능:

```bash
/tmp/topic-mlx-venv/bin/python ml/topic/infer.py --passage-file /tmp/p.txt
pbpaste | /tmp/topic-mlx-venv/bin/python ml/topic/infer.py
```

stdout 예:

```json
{ "ok": true, "question_data": { "Question": "…", "Paragraph": "…", "Options": "① … ### ② …", … } }
```

`Paragraph`는 추론 후 **입력 원문으로 강제 덮어쓴다** (모델이 지문을 변형하는 것 방지).

### 6.5 앱 CLI (passage_id → draft → prevalidate)

```bash
# DB 지문 로드 → 로컬 모델 → .variant-drafts/ 저장 → prevalidate
npm run cc:topic-local -- --passage-id <ObjectId>

# 검증 통과 후 DB insert (status=대기, ai_source=local-topic-lora)
npm run cc:topic-local -- --passage-id <ObjectId> --save

# 파일 지문 (prevalidate의 원문 대조는 passage-id 있을 때만)
npm run cc:topic-local -- --passage-file /tmp/p.txt --textbook "교재" --source "출처"
```

`ai_source` 마커: **`local-topic-lora`** — 클로드/Pro 채팅 작성분과 구분.

---

## 7. 첫 실험 결과 (이 Mac에서 실제로 돌린 것)

| 항목 | 값 |
|------|-----|
| Base | `mlx-community/Llama-3.2-3B-Instruct-4bit` |
| Iter | 100 (짧은 스모크) |
| Trainable | ~0.108% (3.5M / 3.2B) |
| Peak mem | ~6.0 GB |
| Val loss | 1.437 → **1.166** |
| 소요 | 모델 다운로드 포함 ~9분 전후 |

### 관찰 (품질)

- JSON **골격**(Question / Options / CorrectAnswer / Explanation)은 나오기 시작함  
- 100 iter는 짧아서  
  - Options가 명사구가 아니라 **문장형**으로 흐트러지거나  
  - Explanation **반복·잘림**  
  이 자주 보임  
- `infer.py`는 `max_tokens` 기본 4096 + **잘린 JSON 닫기 복구**를 넣어둠  

→ “파이프라인은 된다 / 품질은 더 긴 학습·더 큰 모델·Windows가 필요”가 첫 교훈.

---

## 8. 개념 정리 (공부용)

### LoRA / QLoRA

- 베이스 가중치는 거의 고정하고, **작은 행렬(어댑터)** 만 학습  
- 저장·공유는 `adapters.safetensors` 정도면 됨 (수~수십 MB~GB 규모)  
- 4bit 베이스 + LoRA ≈ 메모리 절약 (맥 16GB에서 3B가 버티는 이유)

### MLX

- Apple Silicon용 배열·LLM 라이브러리  
- CUDA 대신 **Metal**  
- CLI: `mlx_lm.lora`, Python: `mlx_lm.load` / `generate`

### 손실(`--mask-prompt`)

- user/system 토큰까지 전부 맞추라고 하면 “지문 복사”에 학습이 새기 쉬움  
- prompt를 마스크하면 **우리가 원하는 JSON assistant**에 더 집중

### prevalidate가 하는 일

학습 loss와 별개로, 저장소 규칙으로 **기계 검증**:

- CorrectAnswer가 ①~⑤인지  
- Options가 `###`로 5개인지 (주제 등)  
- 유형별 구조 (주제는 Paragraph `<u>` 금지 등 — 스크립트·AUTHORING 참고)

모델이 “대충 맞는 문장”을 내도, **우리 제품 스키마**에 안 맞으면 여기서 걸린다.

---

## 9. 하지 않는 것 / 혼동 금지

- 주문 파이프라인 `pipeline:BV-…` 에 이 로컬 모델을 **자동 연결하지 않음**  
  (Pro 채팅 채움 · API 과금 정책과 섞이면 안 됨)  
- `variant_generate_draft` / Anthropic 키로 데이터 **증강하지 않음** (자체 모델 실험 취지)  
- 제목·주장 등 **다른 유형 동시 학습**은 주제 파이프가 안정된 뒤  
- 랭체인·벡터DB·from-scratch pretrain

---

## 10. 다음에 해볼 체크리스트

1. [ ] `./ml/topic/train.sh … 600` (또는 1000) 으로 더 길게 학습  
2. [ ] valid 지문 20개에 `infer.py` → JSON parse율 / prevalidate 통과율 기록  
3. [ ] 사람이 보기 품질(주제 vs 주장 혼동, 보기 길이) 샘플 검수  
4. [ ] 만족 못 하면 **Windows + 더 큰 GPU**로 같은 JSONL 가져와 7B LoRA  
5. [ ] 윈도우에서도 `ai_source`·prevalidate·save 계약은 동일하게 유지

---

## 11. 치트시트 (복붙)

```bash
# 1) 데이터
npm run cc:topic-export

# 2) 환경 (최초 1회)
python3 -m venv /tmp/topic-mlx-venv
/tmp/topic-mlx-venv/bin/pip install -r ml/topic/requirements.txt
export TOPIC_MLX_VENV=/tmp/topic-mlx-venv

# 3) 학습
./ml/topic/train.sh mlx-community/Llama-3.2-3B-Instruct-4bit 600

# 4) 추론 + 검증
npm run cc:topic-local -- --passage-id <ObjectId>
```

---

## 12. 관련 문서

- 짧은 README: [`ml/topic/README.md`](../../ml/topic/README.md)  
- 주제 출제 규칙: [`docs/variant/AUTHORING.md`](../variant/AUTHORING.md)  
- 검수 층: [`docs/variant/REVIEW.md`](../variant/REVIEW.md)
