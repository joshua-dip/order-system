# 서술형 자동 채움 워크플로우 (Pro 전용 · /loop 스케줄러용)

> Claude Code (Pro) 채팅에 이 문서를 첨부하고 **교재명**만 전달하면 한 cycle 을 자동 실행한다.
> **API 키 호출 없음** — `assets/exam_kit/generation_prompt.md` 의 공통 규칙 + `lib/essay-generator-difficulty-appendix.ts` 의 난이도별 추가 지시에 따라 채팅에서 4 난도 ExamData JSON 을 작성하고 `cc:essay save-all` 만 사용한다.

---

## 입력 (호출 방법)

사용자가 한 줄로 호출한다:

```
@scripts/cc-essay-loop-prompt.md 워크플로우대로 교재 "<textbook>" 1 cycle 돌려줘 (target_per_difficulty=N).
```

- `<textbook>` — 교재명 (예: `25년 3월 고1 영어모의고사`).
- `target_per_difficulty=N` (선택, 기본 1) — 각 난이도별 N 건씩 채울 때까지 반복.
  - **N=1 (기본)** — 한 지문 = 4 난도 1 셋. 옛 동작과 동일.
  - **N=4 등** — 한 지문에 각 난이도 N 건씩 (총 4×N 건). `cc:essay next-empty --target-per-difficulty N` 로 부족 난이도만 식별.
- 저장 폴더 (`folder`) 는 **`<textbook>` 와 동일하게 사용**한다. 폴더가 없으면 `cc:essay save-all` 가 placeholder 를 자동 생성하므로 별도 사전 단계 불필요.

---

## 실행 순서 (반드시 이 순서)

### 1. 다음 지문 받기

```
npm run cc:essay -- next-empty --textbook "<textbook>" --target-per-difficulty <N>
```

(N 미지정 시 1 — 옛 동작)

응답 JSON 을 보고 분기:

### 2. 응답이 `{done: true}` 이면

- 사용자에게 **「<textbook>」 자동 채움 완료** 메시지 전송.
- **ScheduleWakeup 호출하지 말고** 종료.

### 3. 응답에 `next.passage_id` 가 있으면

응답 형태:
```jsonc
{
  "done": false,
  "next": {
    "passage_id": "...",
    "source_key": "...",
    "currentByDifficulty": { "기본난도": 0, "중난도": 0, "고난도": 0, "최고난도": 0 },
    "shortByDifficulty":   { "기본난도": 1, "중난도": 1, "고난도": 1, "최고난도": 1 },
    "shortLabels": ["기본난도", "중난도", "고난도", "최고난도"],
    "totalToMake": 4
  }
}
```

**중요**: `shortByDifficulty` 의 부족한 난이도만 그만큼 만든다. 이미 채워진 난이도는 건드리지 말 것.

- N=1 (기본) → `shortByDifficulty` 가 항상 `{기본:1, 중:1, 고:1, 최고:1}` — 4 난도 전부 새로 만듦 (옛 동작과 동일).
- N=4 인데 어떤 난이도는 2 건 있고 어떤 건 0 건이면 `shortByDifficulty` 가 `{기본:2, 중:4, 고:0, 최고:3}` 같은 식. 0 인 난이도는 만들지 말고 부족한 만큼만.

#### 3a. 지문·문장표 받기

```
npm run cc:essay -- passage --id <passage_id>
```

응답에서 `passage_id`, `textbook`, `sourceKey`, `original`, `translation`, `sentences` (idx·text·isEssay), `essayHighlightedSentences` 를 보존.

#### 3b. 부족 난이도 ExamData JSON 작성

- `assets/exam_kit/generation_prompt.md` 의 **공통 규칙** (스키마·청크·검증 체크리스트) + `lib/essay-generator-difficulty-appendix.ts` 의 **난이도별 추가 지시** 를 모두 만족하도록 작성.
- **`shortByDifficulty` 가 알려준 부족 난이도만 그만큼** 만들기. 이미 `currentByDifficulty` 가 충족된 난이도는 새로 만들지 말 것.
- 파일 경로 — 단일 회분 (각 난이도 ≤ 1 건만 만들 때):
  - 기본난도 → `.essay-drafts/<sourceKey_slug>_basic.json`
  - 중난도   → `.essay-drafts/<sourceKey_slug>_mid.json`
  - 고난도   → `.essay-drafts/<sourceKey_slug>_hard.json`
  - 최고난도 → `.essay-drafts/<sourceKey_slug>_max.json`
- 파일 경로 — N>1 다회분 (같은 난이도 여러 개 만들 때):
  - 기본난도 R번째 → `.essay-drafts/<sourceKey_slug>_basic_r<R>.json` (R=2,3,…)
  - 그 외 동일 패턴
  - 이미 있는 R 번호와 안 겹치도록. (`currentByDifficulty.기본난도` 가 2 면 다음 회차는 r3 부터 시작)
- `sourceKey_slug` — `sourceKey` 에서 **영문·숫자·한글 외 문자**를 `_` 로 치환.
- 각 JSON 의 최상위 필드:
  - `passageId` = 3a 의 `passage_id`
  - `textbook`  = `<textbook>`
  - `sourceKey` = 3a 의 `sourceKey`
  - `difficulty` = `기본난도` | `중난도` | `고난도` | `최고난도`
  - `folder`    = `<textbook>` (저장 폴더 — `save-all` 이 없으면 placeholder 자동 생성)
  - `examSubtitle` = `sourceKey` (또는 회차 표시 `${sourceKey} #R` 같이)
  - `data` = ExamData (generation_prompt.md 4. 출력 형식 참고)

##### 같은 난이도 추가 회분 만들 때 다양화 룰 (N>1)
이미 같은 sourceKey+같은 난이도가 존재할 때, 새로 만드는 회분은 아래 중 **둘 이상**을 다르게:

1. **문장 선택** — 가능하면 지문 안의 다른 문장 페어 (예: 1 회차가 sentence 3·5 였으면 2 회차는 4·6) 선택.
2. **bogi 셔플 시드** — 청크 노출 순서를 의도적으로 다르게.
3. **conditions 표현** — 평가 포인트를 같게 두더라도 한국어 메타 설명 문장을 재서술.
4. **examTitle/examSubtitle** 에 회차 인덱스 추가 (예: `조건영작배열 #2`).
5. **grammar_points** 의 강조 순서/짝.

자동 다양화가 어렵거나 문장 수가 부족하면 **2·3·5 만으로도 OK**. 같은 문장 + 같은 셔플 + 같은 grammar_points 인 완전 클론은 만들지 말 것.

#### 3c. 일괄 저장

```
npm run cc:essay -- save-all \
  .essay-drafts/<slug>_basic.json \
  .essay-drafts/<slug>_mid.json \
  .essay-drafts/<slug>_hard.json \
  .essay-drafts/<slug>_max.json
```

- N=1 (기본): 위 4 인자 그대로.
- N>1: 부족 난이도×부족분 수만큼 인자 추가 (예: `_basic.json _basic_r2.json _mid.json _mid_r2.json ...`).
- 부족이 0 인 난이도 파일은 인자에 넣지 말 것 (불필요).

응답 JSON 의 `results[*].ok` 와 `folders_ensured` 를 확인한다.

#### 3d. 검증 실패 처리

- `results[*].ok === false` 가 **한 건이라도** 있으면 즉시 멈춤.
- 실패 항목의 `validation.errors` 와 `validation.warnings` 를 사용자에게 보고.
- **ScheduleWakeup 호출 안 함**.
- **`--force` 자동 우회 절대 금지** — 사용자가 명시적으로 "force 로 저장해" 라고 지시한 경우에만 다시 시도.

### 4. 정상 저장 완료

- `results[*].ok` 가 모두 true 이면 사용자에게 한 줄 요약 보고 (저장된 examId · folder · difficulty 4 개).
- `ScheduleWakeup(10 minutes)` 호출 — 10 분 후 동일 워크플로우 자동 재진입 (다음 0 건 지문 처리).

---

## 난이도별 핵심 차이 (4 난도 간 다양화 권장)

| 난이도   | bogi 형식                                            | 변형 강도 |
| -------- | --------------------------------------------------- | --------- |
| 기본난도 | 정답 청크를 **원문 그대로** 의미 단위로 분할 · 순서만 셔플 | 변형 0    |
| 중난도   | 1~2 청크에 **어형 변형** (예: 동사 원형·과거·-ing 중 하나) | 1~2 청크  |
| 고난도   | **키워드 lemma 만** 알파벳순 나열 (학생이 직접 활용형 결정) | 키워드만  |
| 최고난도 | **bogi 에 한국어 해석 한 줄만** — 영어 토큰 노출 금지     | 완전 영작 |

### 4 난도 간 변칙 / 다양화 원칙 (중요)

이 출제의 목적은 **다양한 문장에 학생이 노출되게 하는 것**. 4 난도가 같은 문장 두 개로만 묶이면 학생 입장에서 같은 자료를 4 번 다시 푸는 느낌이라 학습 폭이 좁아진다. 따라서 **4 난도가 꼭 다를 필요는 없지만, 가능하면 변칙을 줄 것**.

- 지문에 **충분한 문장이 있을 때**(`isEssay` 추천 + 일반 문장 합쳐 4 개 이상) 는 **난도마다 두 문장 페어를 다르게** 선택. 예시 분배:
  - 기본 = 문장 3·5
  - 중   = 문장 4·6
  - 고   = 문장 6·9
  - 최고 = 문장 5·9
  완전히 disjoint 일 필요는 없고 **2~3 난도가 문장 1 개 공유** 정도면 충분.
- 추천 문장(`essayHighlightedSentences`) 은 모두 우선 후보지만, **전부 같은 페어로 4 번 쓰는 것은 피한다**. 추천이 2~3 개뿐이면 일반 문장 중에서도 한두 개를 섞어 변칙을 만들 것.
- 문장 다양화가 정말 불가능한 짧은 지문 (가용 문장 < 4) 일 때만 같은 두 문장으로 4 난도 모두 채워도 OK — 단 이 경우 **반드시** 아래 4 가지 중 **3 가지 이상** 을 난도마다 다르게:
  1. **강조하는 문법 포인트** — `grammar_points` 가 카테고리 차원에서 겹치지 않도록 (예: 기본=수동태 / 중=관계대명사 / 고=분사구문 축약 / 최고=병렬구조).
  2. **bogi 청킹 단위** — 같은 문장도 끊는 위치를 난이도마다 다르게 (의미 단위 안에서 3-단어/2-단어/5-단어 등 길이 분포 변경).
  3. **bogi 순서 셔플** — 단순 알파벳/원본 순 금지. 난도별로 셔플 시드 다르게 보이게.
  4. **conditions 메타 서술** — 같은 평가 포인트라도 한국어 설명 문장을 재서술 (예: "수동태 사용" → "행위 주체를 뒤로 보내는 표현").
- **최고난도 한정**: `conditions` 본문에 정답 문장의 영어 단어·구를 그대로 인용 금지 (난이도 부록 자가검증 (a)~(d) 통과 필수).

> 핵심 — **다양화는 의무가 아닌 권장**이다. 작성 가능하면 적용하고, 지문 자원이 모자라거나 자연스럽지 않으면 같은 문장을 써도 좋다. 단 그 경우 위 4 축 다양화로 보완.

---

## 검증 체크리스트 (3b 작성 직후 자체 점검)

각 JSON 별로 출력 직전 다음을 확인:

- [ ] `answer.text` 의 공백·쉼표 토큰 수 == `word_count.total` == `word_count.words.length` == 조건 6번 "N개의 단어" 의 N
- [ ] `bogi` 의 청크들을 순서대로 합치면 `answer.text` 와 정확히 일치 (쉼표 제외)
- [ ] `passage` 에 `<span class="kr">…</span>` 블록 **정확히 2 개**
- [ ] `grammar_points` 개수 >= 4
- [ ] `meta.difficulty` 가 최상위 `difficulty` 와 일치
- [ ] 고난도라면 generation_prompt.md 3.9 체크리스트 중 **3 개 이상** 충족
- [ ] 최고난도라면 conditions 본문에 영어 단어·구 직접 인용 없는지 (메타용어 화이트리스트만)
- [ ] 4 난도 간 강조 문법 포인트 겹침 최소화

---

## 작업 디렉터리 규칙 (worktree 금지)

- **이 워크플로우는 worktree 만들지 말 것.** 본질이 MongoDB Atlas 쓰기라 격리할 필요 없음. worktree 의 lib/CLI 가 main 보다 오래된 커밋이라 `save-all`·`ensure-folder` 같은 신규 명령이 없을 수 있고, `.env.local` 도 따라가지 않아 `MONGODB_URI` 누락된다.
- 모든 `npm run cc:essay -- ...` 호출은 **메인 작업 디렉터리(`/Users/goshua/next-order`)** 에서 실행한다.
- `.essay-drafts/<slug>_*.json` 4 파일도 메인의 `.essay-drafts/` 에 작성한다 (write 도구가 막힌 듯하면 worktree 진입 대신 사용자에게 보고하고 멈출 것 — auto-worktree 우회 금지).
- 만약 이미 worktree 안에 들어와 있다면, `cd /Users/goshua/next-order` 로 빠져나온 뒤에만 dry-run·save-all 실행.

## 셸 명령 작성 규칙 (Claude Code 권한 시스템 호환)

- **`for`·`while` 루프, 셸 변수 확장(`$f`, `$VAR`, `${...}`), `xargs` 사용 금지.** 권한 시스템이 "simple_expansion" 으로 판정해 매번 승인 프롬프트가 뜨면서 자동 진행이 끊긴다.
- 4 난도 dry-run 검증·저장도 **개별 명령 4 번**으로 풀어 쓸 것. 예:
  ```
  npm run cc:essay -- save --json .essay-drafts/<slug>_basic.json --dry-run
  npm run cc:essay -- save --json .essay-drafts/<slug>_mid.json --dry-run
  npm run cc:essay -- save --json .essay-drafts/<slug>_hard.json --dry-run
  npm run cc:essay -- save --json .essay-drafts/<slug>_max.json --dry-run
  ```
  4 개를 묶고 싶다면 `save-all` 의 4 인자 형태로 한 줄에 (positional 4 개는 expansion 아니므로 OK):
  ```
  npm run cc:essay -- save-all .essay-drafts/<slug>_basic.json .essay-drafts/<slug>_mid.json .essay-drafts/<slug>_hard.json .essay-drafts/<slug>_max.json --dry-run
  ```
- 모든 호출은 `npm run cc:essay -- ...` 처럼 **인자가 리터럴**이도록 유지 (이미 `Bash(npm run *)` 패턴에 있어 자동 통과).

## 금지 사항 (Pro-only)

- `/api/admin/essay-generator/generate` (Anthropic API) 호출 **금지**.
- `cc:essay save` / `save-all` 의 `--force` **자동 사용 금지** — 검증 실패 시 멈추고 사람에게 보고.
- `cc:essay save-all` 결과에 실패가 한 건이라도 있으면 `ScheduleWakeup` 호출 **금지**.
- 한 cycle 에 1 개 지문 4 난도 처리 후 종료 — 같은 turn 에서 다음 지문으로 진행하지 말 것 (스케줄러 분리 원칙).

---

## 출력 톤 (사용자 보고)

각 단계 후 짧게 진행 상황만:

```
1. next-empty 응답: 다음 지문 「25년 3월 고1 영어모의고사 18번」 (passage_id: 65fa…) — 남은 빈 지문 21건
2. passage 받음 — 문장 14개 · ⭐ 추천 3개 · 기존 essay_exams 0건
3. 4 난도 JSON 작성 완료 — basic/mid/hard/max (.essay-drafts/25_3_go1_18_*.json)
4. save-all 완료 — folders_ensured: [{folder: "25년 3월 고1 영어모의고사", status: "created"}]
   • basic  examId=…
   • mid    examId=…
   • hard   examId=…
   • max    examId=…
5. 10분 후 다음 tick 자동 재호출 (ScheduleWakeup 예약).
```

검증 실패 시:

```
❌ save-all 검증 실패 — 1 건 (mid)
   • word_count.total(16) != words.length(15)
   • bogi 청크 합("…") != answer.text("…")
ScheduleWakeup 호출 안 함. 사용자 검토 필요.
```
