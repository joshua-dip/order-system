# 지문분석기 자동 채움 워크플로우 (cc:syntax · /loop 스케줄러용)

> Claude Code (Pro) 에 이 문서를 첨부하고 **교재명** 만 전달하면 한 cycle (지문 1 건 전 항목 분석) 자동 실행. **API 키 호출 없음**.

---

## 입력 (호출 방법)

```
@scripts/cc-syntax-loop-prompt.md 워크플로우대로 교재 "<textbook>" 1 cycle 돌려줘.
```

옵션:
- `target_percent=N` (기본 100) — 분석 완료 비율 목표. N% 미만인 지문만 처리.

---

## 실행 순서 (반드시 이 순서)

### 1. 다음 빈 지문 받기

```
npm run cc:syntax -- next-empty --textbook "<textbook>" --required <N>
```

(N 미지정 시 100)

### 2. 응답이 `{done: true}` 이면

- 사용자에게 **「<textbook>」 자동 분석 완료** 메시지.
- **ScheduleWakeup 호출하지 말고** 종료.

### 3. 응답에 `next.passage_id` 가 있으면

#### 3a. 지문·문장표 받기

```
npm run cc:syntax -- passage --id <passage_id>
```

응답에서 `passage_id`, `sentences[]` (idx·en·ko), `original`, `translation`, `current_progress` 보존. 그 외 의미 분석은 채팅에서 LLM 이 한다.

#### 3b. 분석 JSON 작성

`scripts/cc-syntax-prompt.md` 의 "3. 분석 항목별 작성 규칙" 에 따라 `.syntax-drafts/<passage_id>.json` 작성. 

**필수**: 12 카테고리 모두 비어있지 않은 값으로 채울 것.

- sentences / koreanSentences — 3a 출력 그대로
- analysisResults.comprehensive (5 슬롯)
- topicHighlightedSentences (1~2)
- essayHighlightedSentences (2~4)
- grammarSelectedWords (5~12)
- contextSelectedWords (5~10)
- sentenceBreaks (모든 문장)
- svocData (모든 문장)
- syntaxPhrases (모든 문장, depth 0~2)
- grammarTags (8~20)
- grammarPointsBySentence (주요 문장)
- vocabularyList (15~30)

#### 3c. dry-run 검증

```
npm run cc:syntax -- save --json .syntax-drafts/<passage_id>.json --dry-run
```

`validation.ok === false` 이면 즉시 멈추고 errors 사용자에게 보고. **ScheduleWakeup 호출 X**, **`--force` 자동 사용 금지**.

#### 3d. 저장

```
npm run cc:syntax -- save --json .syntax-drafts/<passage_id>.json
```

응답의 `progress.percent === 100` 확인.

### 4. 정상 저장 완료

- 한 줄 보고 (passageId · progress.percent).
- `ScheduleWakeup(10 minutes)` 호출 — 10 분 후 동일 워크플로우 자동 재진입.

---

## 셸 명령 작성 규칙 (Claude Code 권한 시스템 호환)

- **`for`·`while` 루프, 셸 변수 확장, `xargs` 사용 금지** — 권한 프롬프트 매번 떠서 자동 진행 끊김.
- 모든 호출은 `npm run cc:syntax -- ...` 처럼 **인자가 리터럴**.
- 작업 디렉터리는 **메인 (`/Users/goshua/next-order`)** — worktree 만들지 말 것.

---

## 금지 사항 (Pro-only)

- `passage-analyzer-cli.ts run-ai` 호출 **금지**.
- `/api/admin/passage-analyzer/comprehensive-analysis` 등 AI 라우트 호출 **금지**.
- 검증 실패 시 `ScheduleWakeup` 예약 **금지**.
- 한 cycle 에 지문 1 건만 처리 후 종료 (스케줄러 분리).

---

## 출력 톤 (사용자 보고)

```
1. next-empty 응답: passage 65fa…ab (source_key: 25년 3월 고1 영어모의고사 18번) — 남은 빈 지문 21건
2. passage 받음 — 문장 14개 · 현재 진척률 30%
3. 분석 JSON 작성 완료 — .syntax-drafts/65fa…ab.json (12 카테고리 모두 채움)
4. save 완료 — progress 100% · version 7
5. 10분 후 다음 tick 자동 재호출 (ScheduleWakeup 예약).
```

검증 실패 시:
```
❌ dry-run 검증 실패
   • syntaxPhrases[3][2].endIndex=15 가 startIndex~12 밖
   • vocabularyList[8].positions[0].sentence=14 가 0~12 밖
ScheduleWakeup 호출 안 함. 사용자 검토 필요.
```
