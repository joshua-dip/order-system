# 로컬 LoRA 변형문제 AI — Claude Code → Codex 인수인계 (2026-09-26)

맥(M5 Max) 한 대에서 도는 **로컬 변형문제 AI**를 이어받기 위한 문서. 지금까지의 과정·수치·교훈은
**실습 노트**([`docs/ml/lora-notebook/notebook.html`](../ml/lora-notebook/notebook.html), 22과 + 개선 기록 표)에 다 있다.
이 문서는 「지금 상태 · 도는 법 · 지킬 규칙 · 다음 할 일」만 추린다.

---

## 1. 지금 상태

**구성** — 웹 관리자 「로컬 LoRA로 초안」 → `local_variant_jobs` 큐 → 맥 워커가 처리 → 관리자가 검수·저장.

| 역할 | 모델 |
|---|---|
| 초안(유형별 LoRA) | `mlx-community/Qwen2.5-7B-Instruct-4bit` + LoRA(rank 8, 마지막 8층, 3000 iters, lr 1e-5, `--mask-prompt`) |
| 판정·다시 쓰기·모의 풀이·해설 | `mlx-community/Qwen3.6-35B-A3B-4bit` (reasoner, 어댑터 끔) |

**12유형** (`lib/local-variant-types.ts` ↔ `ml/worker/local_variant_worker.py` 의 `TYPES` — 두 표는 같아야 한다)

| 유형 | 방식 | 폴더 | 누수 없는 점수(18지문×2회) |
|---|---|---|---|
| 주제·제목·주장 | LoRA + 35B 오답 심사 | `ml/topic` `ml/title` `ml/claim` | 사람 83.3 · 80.6 · 94.4% |
| 일치·불일치 | LoRA 하나(`ml/fact`) + 선지별 사실 확인 | `ml/fact` | 두 순서 재확인 78.9 · 92.1% |
| 빈칸 | LoRA(가릴 구절만) + 넣어 보기 판정 | `ml/blank` | 사람 69.4% |
| 요약 | LoRA(요약문+쌍) + 쌍 넣어 보기·유의어 확인 | `ml/summary` | 사람 50.0% |
| 순서·삽입 | **LoRA 없음** — 규칙 생성 + 35B 모의 풀이 | `ml/common/rule_pipeline.py` | 사람 16/16 · 16/16 |
| 무관한문장·어휘·어법 | **LoRA 없음** — 한 곳만 고치기 + 방향별 확인 | `ml/common/edit_pipeline.py` | 사람 83.3 · 86.1 · 94.4% |

- 배포 상태: 커밋 `efa1290` 까지 main 푸시·배포 완료(웹에서 12유형 선택 가능).
- 어댑터·학습 데이터는 git 에 없다(`.gitignore`). 재학습 때 옛 어댑터는 `ml/<유형>/adapters/<유형>-lora.prev-<시각>` 으로 남는다.
- 실사용 지표: `npm run cc:local-usage` (초안 ↔ 저장본: 그대로/조금/크게/버림). 09-26 기준 저장분이 거의 없어 아직 의미 있는 수치 없음.

---

## 2. 도는 법

```bash
# 워커 재시작 (파이프라인 코드를 고치면 반드시)
launchctl kickstart -k gui/$(id -u)/com.gomijoshua.local-variant-worker

# 학습 데이터 → 학습 (≈40분, 잠자기 방지 필수)
npm run cc:<topic|title|claim|fact|blank|summary>-export
caffeinate -i ./ml/common/train_mlx.sh <유형>

# 고정 시험지 평가 (결과: ml/eval/runs/sep26-go1/<label>.jsonl — git 제외)
caffeinate -i ml/topic/.venv/bin/python ml/eval/run_eval.py --label 2026-MM-DD-xxx --types summary --repeat 2
#   유형 이름: topic title claim match mismatch blank order insert irrelevant vocab grammar summary

# 채점관(35B) 재판정 — 선지 순서를 바꿔 두 번(judge2). 일치·불일치·빈칸 규칙 통과, 주제·제목·주장 오답 지표
ml/topic/.venv/bin/python ml/eval/judge_distractors.py --set sep26-go1 --label <label>

# 사람 채점용으로 펼쳐 보기
python3 ml/eval/view.py --set sep26-go1 --label <label> --types topic          # 주제·제목·주장·빈칸 등
python3 ml/eval/dump_summary.py <label>                                         # 요약
ml/topic/.venv/bin/python ml/eval/dump_edit.py <label> vocab < /dev/null       # 무관·어휘·어법

# 성적표(% 비교)
python3 ml/eval/view.py --set sep26-go1 --report <label1>,<label2>

# 노트 PDF (~/Downloads/변형문제 LoRA 실습 노트.pdf)
node docs/ml/lora-notebook/print-notebook.cjs
```

**사람 채점 기록**: `ml/eval/grades/sep26-go1/<label>.json` — `{"grader", "code", "notes": {...}, "grades": {"20번|summary": "O", "20번|summary|2": "P"}}`
(O 맞음 · P 부분 · X 틀림 · F 생성 실패, `|2` 는 두 번째 반복). 이 파일은 커밋한다.

---

## 3. 지킬 규칙

1. **Anthropic API 호출 금지** (Pro 전용 운영). `variant_generate_draft`·`/api/**/generate` 류 쓰지 않는다. 로컬 AI 는 전부 맥 MLX.
2. **`MONGODB_URI` 출력 금지.** 평가·채점 스크립트는 워커 `.env` 에서 읽기만 한다. 주문 찾기용 임의 Mongo 쿼리 금지.
3. **커밋·푸시·배포는 사용자가 말할 때만.** 배포 = main 푸시(Amplify 자동). 푸시 전 깨끗한 worktree 에서 `npx next build`.
4. **어댑터·학습 데이터·평가 실행 결과(`runs/`)는 커밋하지 않는다.** 채점 기록(`grades/`)은 커밋한다.
5. **개선할 때마다 노트에 기록** — `docs/ml/lora-notebook/notebook.html` 의 「개선 기록」 표에 한 줄(날짜·유형·문제·바꾼 것·결과·과), 큰 교훈이면 새 과 섹션 + 목차(`nav.toc`) 항목, 끝에 PDF 재생성. (노트는 원래 claude.ai 아티팩트로도 올렸지만, 이제 원본은 이 파일이다.)
6. **학습 export 에서 평가 세트 교재는 자동으로 빠진다**(`scripts/_eval-set-filter.ts`). 새 시험지는 `ml/eval/sets/<이름>.json` 만 추가하면 된다. 새 export 스크립트를 만들면 이 필터를 꼭 붙인다.

---

## 4. 여기까지 배운 것 (다시 밟지 말 것)

- **한 번 돌린 점수는 ±7%p 흔들린다** — 항상 `--repeat 2`, 5%p 안팎 차이는 「같다」로 읽는다.
- **채점관(35B)도 선지 순서에 따라 판정이 바뀐다** — 그래서 judge2(두 순서). **빈칸은 채점관 ≠ 사람**이라 사람 채점이 기준.
- **모의 풀이 통과 ≠ 옳은 문항** — 35B 는 「튀는 한 곳」만 찾아도 맞힌다. 틀릴 수 있는 방향마다 따로 묻는다(어법: 바꾼 문장이 문법에 맞나 / 무관: 흐름에 맞나 / 요약: 오답 두 칸이 정답 유의어인가).
- **「k번째를 바꿔라」를 한 번에 시키면 번호를 헷갈린다** — 고르기와 바꾸기를 두 번에 나눠 묻는다.
- **셀 수 있는 건 코드로** — 겹침(낱말 70%/빈칸 90%), 모양(명사구·헤드라인), 조사(①이·②가), 한자 제거, 답 드러남(정답 낱말 앞 5글자), a/an·전치사 묶인 낱말.
- **다시 쓰기가 같은 문장을 되풀이하면** 거절된 시도를 보여 주고 온도 0.8.
- **`while s[:1] in X` 무한 루프**(`''` 는 모든 문자열에 들어 있다) → `while s and s[0] in X`. 한 문항 20분 멈춤의 원인이었다.
- **평가 실행은 `caffeinate -i`** — 맥이 잠들면 한 문항 33분.
- **평가 지문이 학습 데이터에 섞여 있었다**(22과) — 빼니 대부분 3~6%p 하락. 누수 없는 수치가 위 표.

---

## 5. 다음 할 일 (추천 순서)

1. **두 번째 시험지** — 지금 모든 규칙을 같은 18지문(26년 9월 고1)으로 고치고 같은 18지문으로 쟀다. 다른 달·학년 모의고사 18지문으로 `ml/eval/sets/<새이름>.json`(기존 파일 형식 그대로: textbook·types·passages[num,key,pitfalls])을 만들고, **코드 수정 없이** 전 유형을 한 번 재서 과적합 여부를 본다. (세트 json 만 추가하면 학습 export 에서 자동 제외되므로, 재학습하면 그 교재도 빠진다.)
2. **요약(50%) 개선** — 남은 결함: 요약문이 요지를 비껴감, 「그대로도 읽힐」 오답. v1~v5 기록은 노트 21과·`grades/…summary-v*.json`. 데이터 거르기(v5)로는 제자리였다.
3. **빈칸(69%) 「바꿔 쓴 오답이 정답으로도 읽힘」** — 37번 천동설 풀어쓴 오답 셋, 35번 「주 2회 이하」. 요약에서 쓴 유의어 확인(`SYN_SYS`)을 빈칸 오답에도 적용해 볼 만하다.
4. **주제·제목 무관 오답 증가** — 재학습 후 「무관 오답 2개+ 문항」 16.7→23.6%, 17.1→26.4%(judge2). `ml/common/distractor_check.py` 의 `MAX_OFF_TOPIC=1` 교체 로직이 새 어댑터에서도 도는지 확인.
5. **실사용 지표 쌓기** — 주문 부족분을 로컬 초안으로 만들어 관리자에서 검수·저장 → `cc:local-usage`. 시험지보다 정직한 성적표.

---

## 6. 파일 지도

| 파일 | 내용 |
|---|---|
| `ml/worker/local_variant_worker.py` · `inference_child.py` | 워커(launchd), 유형 표 `TYPES`·`RULE_TYPES` |
| `ml/common/mlx_runtime.py` | MLX 로딩·어댑터 전환·35B reasoner |
| `ml/common/distractor_check.py` | 오답 심사·모의 풀이(`solve_check`)·유형별 `KINDS` |
| `ml/common/json_extract.py` | JSON 뽑기, 해설 정리(한자 제거·정답 번호 검사) |
| `ml/common/option_form.py` | 주제·제목 모양 검사 |
| `ml/common/rule_gen.py` · `rule_pipeline.py` | 순서·삽입 (학습실 `lib/practice-generator.ts` 파이썬판 — 한쪽 고치면 다른 쪽도) |
| `ml/common/edit_pipeline.py` | 무관한문장·어휘·어법 |
| `ml/<유형>/windows/pipeline_<유형>.py` | 유형별 파이프라인 (SYSTEM_PROMPT 는 export 스크립트와 한 글자까지 같아야 함) |
| `scripts/export-<유형>-finetune-jsonl.ts` · `_eval-set-filter.ts` | 학습 데이터 export |
| `ml/common/train_mlx.sh` | 학습 |
| `ml/eval/` | `sets/` 시험지 · `run_eval.py` · `judge_distractors.py` · `view.py` · `dump_*.py` · `grades/` |
| `lib/local-variant-types.ts` · `lib/local-variant-jobs.ts` · `scripts/cc-local-usage.ts` | 웹 쪽 유형 표·작업 큐·실사용 지표 |
| `docs/ml/lora-notebook/` | 실습 노트(원본 HTML)와 PDF 인쇄 스크립트 |
