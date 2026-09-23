# 제목 유형 — Windows + NVIDIA CUDA QLoRA

주제 파이프라인(`docs/ml/topic-windows-cuda.md`)을 그대로 복제했다. 데이터·검증·저장 계약은 동일하고
프롬프트·검증 규칙만 제목 전용(`docs/variant/AUTHORING.md` "주제·제목·주장·일치·불일치" 절 — 제목은
7~12단어 뉴스 헤드라인 스타일, 각 선택지 대문자 시작)이다. Claude/Anthropic API 는 쓰지 않는다.

```
npm run cc:title-export          # data/title-finetune/train.jsonl
        ↓
ml/title/windows/train.py        # QLoRA (bitsandbytes 4bit)
        ↓
adapters/title-lora-cuda/
        ↓
infer.py → prevalidate → (옵션) DB 저장  (ai_source=local-title-lora)
```

---

## 1. 준비물

| 항목 | 권장 |
|------|------|
| OS | Windows 10/11 |
| GPU | NVIDIA **VRAM 12GB+** (3B), **24GB+** (7B QLoRA) |
| 드라이버 | 최신 Game Ready / Studio + `nvidia-smi` 동작 |
| Python | **3.11 또는 3.12** (PATH 등록, "Install launcher" OK) |
| Node | 기존 next-order 와 동일 (`npm` 로 export·cc-title-local) |
| 디스크 | 모델 캐시 ~15–20GB (Hugging Face `~/.cache/huggingface`) |

VRAM이 부족하면 기본 7B 대신 **`Qwen/Qwen2.5-3B-Instruct`** 로 학습한다.
**GTX 1050 Ti (4GB)** 처럼 더 작으면 **`-LowVram`** (0.5B + 4bit 끔) 을 쓴다.

**venv 는 `ml/topic/windows/.venv` 를 재사용해도 된다** — 주제·제목·주장 세 파이프라인의 Python
의존성(torch/transformers/peft/trl/bitsandbytes)이 완전히 같다. 디스크·설치 시간을 아끼려면
`setup.bat` 을 새로 돌리지 말고 `TITLE_CUDA_VENV=<repo>\ml\topic\windows\.venv` 를 지정한다.
따로 두고 싶으면 아래처럼 이 폴더에서 그대로 `setup.bat` 을 돌려도 된다(완전히 독립적으로 동작).

---

## 2. 최초 세팅 (한 번)

```bat
cd ml\title\windows
setup.bat
```

하는 일: `.venv` 생성 → PyTorch CUDA 12.4 wheel 설치 → `transformers`/`peft`/`trl`/`bitsandbytes` 설치 →
`torch.cuda.is_available()` 확인 출력. `cuda=False` 면 `nvidia-smi`·PyTorch CUDA 버전을 확인한다.

---

## 3. 데이터 export

```bat
npm run cc:title-export
```

성공 시 `data/title-finetune/train.jsonl`, `valid.jsonl`, `meta.json`. `generated_questions` 의
`type: "제목"`(완료 상태) 문서를 지문과 대조해 만든다 — **아직 제목 완료 문항이 없으면 0건**이다.
그때는 `--status all` 로 대기 포함 여부를 먼저 확인하거나, 관리자 화면 「Claude로 초안 생성」으로
소량의 제목 문항을 먼저 채운 뒤 다시 export한다(학습 데이터 확보 목적이며 이 문서의 "로컬 LoRA로
서비스"와는 별개 단계).

---

## 4. 학습

```bat
cd ml\title\windows
train.bat
train.bat Qwen/Qwen2.5-3B-Instruct 600
```

또는:

```bat
.venv\Scripts\activate.bat
python train.py --model Qwen/Qwen2.5-7B-Instruct --epochs 1
python train.py --low-vram --max-steps 600
```

산출물: `ml/title/adapters/title-lora-cuda/`, `train_meta.json`.

---

## 5. 추론

### 원샷

```bat
cd ml\title\windows
ask.bat
```

### 파이프라인 (권장 — 0.5B)

작은 모델은 한 방 생성보다 **핵심 메시지 → 헤드라인 초안 → 정답검증 → 오답검증 → 해설**이 안정적이다.

```bat
ask_pipeline.bat
.venv\Scripts\python.exe pipeline_title.py --passage-file C:\temp\p.txt --json-only
```

실패·수정 힌트는 `data/title-pipeline-failures/failures.jsonl` 에 쌓인다(gitignore).

### 해설 전용 LoRA (DB Explanation)

```bat
REM 저장소 루트
npm run cc:title-explain-export

cd ml\title\windows
train_explain.bat
```

산출물: `ml/title/adapters/title-explain-lora-cuda/`. `ask_pipeline.bat` 실행 시 이 폴더가 있으면
explain 단계에만 해당 어댑터를 켠다.

### 앱 CLI (prevalidate / 저장)

```bat
REM 저장소 루트
set TITLE_BACKEND=cuda
npm run cc:title-local -- --passage-id <ObjectId>
npm run cc:title-local -- --backend cuda --pipeline --passage-id <ObjectId>
npm run cc:title-local -- --backend cuda --pipeline --passage-id <ObjectId> --save

REM 통합 진입점(주제/제목/주장 공용)으로도 같은 일을 한다
npm run cc:local-variant -- --type 제목 --backend cuda --pipeline --passage-id <ObjectId> --save
```

`ai_source` 는 **`local-title-lora`**. `TITLE_CUDA_VENV` 로 venv 경로를 지정할 수 있다
(기본: `ml/title/windows/.venv`).

---

## 6. 주제(topic)와의 차이

| | 주제 | 제목 |
|--|------|------|
| Question | "이 글의 주제로 가장 적절한 것은?" | "이 글의 제목으로 가장 적절한 것은?" |
| Options 형태 | 영어 명사구, 소문자 시작 | **영어 헤드라인 스타일, 대문자 시작** |
| 초점 | 무엇에 관한 글인가(설명) | 핵심 메시지를 헤드라인으로(함축·후킹) |
| 금지 | 주장·실천 문장 | 고유명사·인명·책제목·비유 이름 자체 |

파이프라인 단계명도 다르다: 주제는 `claim`(핵심 주장 추출) 단계로 시작하지만, 제목은
`message`(핵심 메시지 추출) 단계로 시작한다 — `pipeline_title.py` 참고.

---

## 7. 권장 진행 순서

0. [ ] (선택) GPU 없이 골격만: `python smoke_check.py`
1. [ ] `setup.bat` → `cuda=True` 확인 (또는 주제 venv 재사용)
2. [ ] `npm run cc:title-export` — 0건이면 먼저 제목 완료 문항을 확보
3. [ ] `train.bat … 100` 스모크 → `ask.bat` 로 JSON 골격 확인
4. [ ] `train.bat` 1 epoch 또는 `--max-steps 600~2000`
5. [ ] valid 지문 20개: JSON parse율 / `cc:title-local` prevalidate 통과율
6. [ ] 품질 부족 시 7B 유지 + steps↑

---

## 8. 관련 문서

- 주제 원본 가이드: [`topic-windows-cuda.md`](./topic-windows-cuda.md)
- Windows 치트시트: [`ml/title/windows/README.md`](../../ml/title/windows/README.md)
- 제목 출제 규칙: [`docs/variant/AUTHORING.md`](../variant/AUTHORING.md) — "주제 · 제목 · 주장 · 일치 · 불일치" 절
