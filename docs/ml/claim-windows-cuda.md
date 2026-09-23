# 주장 유형 — Windows + NVIDIA CUDA QLoRA

주제 파이프라인(`docs/ml/topic-windows-cuda.md`)을 복제했지만 **주장은 파이프라인 단계 자체가
다르다** — 자세한 이유는 §6. Claude/Anthropic API 는 쓰지 않는다.

```
npm run cc:claim-export          # data/claim-finetune/train.jsonl
        ↓
ml/claim/windows/train.py        # QLoRA (bitsandbytes 4bit)
        ↓
adapters/claim-lora-cuda/
        ↓
infer.py → prevalidate → (옵션) DB 저장  (ai_source=local-claim-lora)
```

---

## 1. 준비물

| 항목 | 권장 |
|------|------|
| OS | Windows 10/11 |
| GPU | NVIDIA **VRAM 12GB+** (3B), **24GB+** (7B QLoRA) |
| 드라이버 | 최신 Game Ready / Studio + `nvidia-smi` 동작 |
| Python | **3.11 또는 3.12** |
| Node | 기존 next-order 와 동일 |
| 디스크 | 모델 캐시 ~15–20GB |

VRAM이 부족하면 **`Qwen/Qwen2.5-3B-Instruct`**, **GTX 1050 Ti (4GB)** 는 **`-LowVram`** (0.5B + 4bit 끔).

**venv 는 `ml/topic/windows/.venv` 를 재사용해도 된다** — 세 파이프라인의 Python 의존성이 같다.
`CLAIM_CUDA_VENV=<repo>\ml\topic\windows\.venv` 로 지정하면 이 폴더에서 다시 `setup.bat` 을
돌릴 필요가 없다.

---

## 2. 최초 세팅 (한 번)

```bat
cd ml\claim\windows
setup.bat
```

---

## 3. 데이터 export

```bat
npm run cc:claim-export
```

성공 시 `data/claim-finetune/train.jsonl`, `valid.jsonl`, `meta.json`. `generated_questions` 의
`type: "주장"`(완료 상태) 문서 기준이라 — **주장 완료 문항이 없으면 0건**이다.
`docs/variant/AUTHORING.md`의 "설명문 지문의 주장" 절이 지적하듯 주장 재고는 실수로
"주제문+should" 로 저장된 것이 섞여 있을 수 있다. 학습 데이터 품질이 곧 LoRA 품질이므로,
가능하면 export 전에 그런 항목을 걸러 두는 편이 낫다(이 스크립트 자체는 필터링하지 않는다).

---

## 4. 학습

```bat
cd ml\claim\windows
train.bat
train.bat Qwen/Qwen2.5-3B-Instruct 600
```

산출물: `ml/claim/adapters/claim-lora-cuda/`, `train_meta.json`.

---

## 5. 추론

### 원샷

```bat
cd ml\claim\windows
ask.bat
```

### 파이프라인 (권장 — 0.5B, 특히 주장은 꼭 파이프라인을 쓸 것)

```bat
ask_pipeline.bat
.venv\Scripts\python.exe pipeline_claim.py --passage-file C:\temp\p.txt --json-only
```

실패·수정 힌트는 `data/claim-pipeline-failures/failures.jsonl` 에 쌓인다.

### 해설 전용 LoRA

```bat
npm run cc:claim-explain-export
cd ml\claim\windows
train_explain.bat
```

산출물: `ml/claim/adapters/claim-explain-lora-cuda/`.

### 앱 CLI (prevalidate / 저장)

```bat
set CLAIM_BACKEND=cuda
npm run cc:claim-local -- --passage-id <ObjectId>
npm run cc:claim-local -- --backend cuda --pipeline --passage-id <ObjectId> --save

REM 통합 진입점
npm run cc:local-variant -- --type 주장 --backend cuda --pipeline --passage-id <ObjectId> --save
```

`ai_source` 는 **`local-claim-lora`**. `CLAIM_CUDA_VENV` 로 venv 경로 지정 가능.

---

## 6. 왜 주장 파이프라인은 단계가 다른가

`docs/variant/AUTHORING.md`의 핵심 지적: **주제는 「무엇에 관한 글인가」, 주장은 「독자가
무엇을 해야 하는가」다.** 논지 문장의 술어만 조동사로 바꾼 문장("주제문 + should")은 주제와
겹치는 실패작이다 — 2026-09-12 배치에서 여러 에이전트가 독립적으로 이 문제를 보고했다.

그래서 `pipeline_claim.py` 는 주제/제목에 없는 **`practical`(실천 claim 도출) 단계**와
전용 검증(`verify_practical` — "논지+should 재탕인지" 자동 판별)을 하나 더 둔다:

```
thesis(논지 추출) → practical(실천 층위로 한 단계 내려오기) → verify_practical(재탕 검증)
  → draft(오답 4개 — 반대 방향 + "반 발짝 벗어난 실천" 혼합) → verify/revise → explain
```

Options 형식도 다르다 — 주제/제목은 **명사구**, 주장은 **완전한 문장**
(`must/should/have to` 등 조동사 또는 `important/essential/…` 형용사 필수, you/he/she 로
시작 금지). `_format_ok()`/`pipeline_claim.py`의 `_has_modal_or_adj`·`_starts_bad_subject`가
이 형식을 강제한다.

| | 주제 | 주장 |
|--|------|------|
| Question | "…주제로 가장 적절한 것은?" | "…주장하는 바로 가장 적절한 것은?" |
| Options 형태 | 명사구 | **완전한 문장(조동사/형용사 필수)** |
| 오답 설계 | 지문과 어긋남 | **반대 방향 + 반 발짝 벗어난 실천 혼합**(방향만 뒤집으면 안 됨) |
| 고유 검증 단계 | 없음 | **practical 재탕 검증** |

---

## 7. 권장 진행 순서

0. [ ] (선택) `python smoke_check.py`
1. [ ] `setup.bat` → `cuda=True` (또는 주제 venv 재사용)
2. [ ] `npm run cc:claim-export` — 0건이면 먼저 주장 완료 문항 확보
3. [ ] `train.bat … 100` 스모크 → `ask_pipeline.bat` 로 **practical 단계가 논지 재탕이 아닌지** 눈으로 확인
4. [ ] `train.bat` 1 epoch 또는 `--max-steps 600~2000`
5. [ ] valid 지문 20개: JSON parse율 / `cc:claim-local` prevalidate 통과율 /
       정답 선택지가 실제로 "실천 문장"인지(논지 그대로 + should 만 아닌지) 사람이 재확인
6. [ ] 품질 부족 시 steps↑, practical 단계 재검증 강화

---

## 8. 관련 문서

- 주제 원본 가이드: [`topic-windows-cuda.md`](./topic-windows-cuda.md)
- Windows 치트시트: [`ml/claim/windows/README.md`](../../ml/claim/windows/README.md)
- 주장 출제 규칙: [`docs/variant/AUTHORING.md`](../variant/AUTHORING.md) — "주제 · 제목 · 주장 · 일치 · 불일치" 절,
  특히 "설명문 지문의 주장" 하위 절
