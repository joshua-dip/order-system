# 변형문제 검수 가이드라인

작성 규칙은 [AUTHORING.md](AUTHORING.md). 이 문서는 **저장 전후로 무엇을 어떻게 확인하는가**다.

핵심은 하나다 — **검증기가 세 층으로 나뉘어 있고, 층마다 못 잡는 것이 다르다.**
한 층만 통과시키고 넘어가면 결함이 조용히 「완료」가 된다.

## 세 층

| 층 | 실행 시점 | 무엇을 보나 | 못 잡는 것 |
|---|---|---|---|
| **사전검증** `scripts/cc-variant-prevalidate.ts` | 저장 **전**, DB 없이 | 정합성 + per-question | 저장 시 셔플로 바뀌는 것 |
| **자동검수** `recordReviewLogFromClaudeCode` | 대기 → 완료 승격 시 | DB 정답 대조 + per-question | **cross-question 결함 전부** |
| **전수검증** `npm run cc:audit` | 배치 저장 후 | 위 + cross-question + 정합성 | 난도·의미 |

`pipeline` 의 자동검수는 **per-question 검증만** 돌린다. 그래서 요약문 누락 같은 결함이
정답만 맞으면 그대로 완료가 된다. **배치 생성 뒤에는 반드시 `cc:audit` 을 교재별로 돌린다.**

---

## 1. 저장 전 — 사전검증

```bash
npx tsx scripts/cc-variant-prevalidate.ts <draft.json>
```

save 입력 배열(`{passage_id, type, question_data}`)을 insert 없이
`checkContentIntegrity` + `runPerQuestionValidations` 로 항목별 보고한다.
**ERROR 0 · warning 0** 이 게이트다.

한 지문에 수십 문항을 만들 때 특히 중요하다 — 64문항을 저장한 뒤 audit 으로 잡으면
패치·삭제가 훨씬 번거롭다.

어법을 대량 생성할 때는 **원문을 한 상수로 두고 모든 Paragraph 를 파생**할 것.
밑줄 밖 텍스트가 원문과 바이트 일치해야 게이트를 통과하는데, 손으로 복붙하면 반드시 깨진다.

---

## 2. 저장 후 — 셔플된 형태로 다시

`save` 는 셔플 O 유형(함의·빈칸·요약·CEFR 5종)의 Options·CorrectAnswer·해설 속 보기번호를
`shuffleQuestionDataForDistribution` 로 **remap** 한다. 저장 전 검증만으로는 셔플 결과를 못 본다.

**저장된 형태로 한 번 더** 같은 검증을 돌려 `declared == CorrectAnswer` 를 확인한다.

> ⚠️ **셔플 함수는 `###` 구분일 때만 동작한다.** Options 를 `split(/\s*###\s*/)` 로만 나누므로
> **줄바꿈 구분 보기(레거시 다수)는 parts=1 로 읽혀 조용히 no-op** 이 된다.
> audit 의 options-format 검증은 줄바꿈도 5보기로 인정하므로 "정상" 인데 재셔플만 안 먹는 비대칭이 생긴다.
> 재셔플이 필요하면 `splitQuestionOptionSegments` 로 나눠 `' ### '` 로 정규화한 뒤 호출하고,
> 원본이 줄바꿈이었으면 결과를 다시 `\n` 으로 복원해 저장 형식을 보존한다.

---

## 3. 배치 저장 후 — 전수검증

```bash
npm run cc:audit -- --textbook "<교재명>"
```

read-only 다. 주문이 여러 교재에 걸치면 **교재마다** 실행한다.

### cc:audit 만 잡는 것

| 검사 | 내용 |
|---|---|
| `summaryStructure` | 요약 `(A)`/`(B)` 누락·위치 |
| 삽입 마커 개수 | 정확히 5개인지 |
| 순서 정답검증 | 원문과 대조 |
| 보기 중복 | 같은 보기 반복 |
| 정합성 | 해설 ↔ 정답, source 접두사 |
| `cefr_advanced_missing_gloss` | CEFR 5종 해설 글로싱 (경고) |

### 요약문 결함 두 패턴

가장 자주 나오는 결함이다. 병렬 에이전트로 요약을 대량 생성하면 특히 잦다 —
실제로 신규 요약 102건 중 **28건**(누락 10 · 본문 위 18)이 나온 적이 있다.

1. **`요약문 누락`** — `Paragraph` 에 `(A)`/`(B)` 가 없음.
   요약문을 `Explanation` 이나 발문에만 쓰고 본문에 빠뜨린 것.
   → `Explanation` 속 의도된 요약문을 `(A)`/`(B)` 빈칸으로 복원해 `본문\n\n요약문` 으로 append.
2. **`요약문이 본문 위`** — `(A)` 가 `Paragraph` 앞 30% 에 위치.
   → `\n\n` 으로 나눠 `(A)(B)` 청크를 끝으로 옮긴다.

정상은 **요약문이 본문 아래(후반 70%)** 다.

### 순서 검증에서 `readingOrder = ABC`

단순 매칭 실패가 아니라 **출제 시 원문 순서를 아예 안 섞은 불량**이다.
자동수정 대상이 아니며 **재생성해야 한다.** `unverifiable` 로 뭉뚱그리지 말 것.

### 서술형은 오탐이 정상

`요약문조건영작배열` 같은 서술형은 Options·CorrectAnswer 가 없어
`correct_answer_missing`(error)·`optionsFormat.missing`("데이터 없음")이 **모든 건에** 뜬다.
**결함이 아니다.** ①~⑤ 가짜 정답을 지어내지 말 것.

`CorrectAnswer: <SampleAnswer 문자열>`(날조 아닌 실제 모범답안)을 넣어 두면
error 가 warning(`correct_answer_format`)으로 내려가 audit 이 조용해지고 렌더는 그대로다.

### 교재별 양성 오탐

부교재(BV) 중 `source_key` 에 교재 prefix 가 없는 것들은
`source_textbook_prefix_mismatch` 가 전 문항에 뜨지만 매칭은 정상이다(수능특강 미니모의고사 등).
이 경우 `perQuestion` · `summaryStructure` · `orderUnified.answerVerify` 만 본다.

---

## 4. 대기 → 완료 승격

```bash
npm run cc:variant -- pipeline:BV-20260907-001
```

부족 파악 + 대기 자동 검수 + 신규 생성 가이드를 한 번에 처리한다.

- 정답이 맞고 검증 error 0 이면 **완료**.
- `attemptNumber` ≥ 2 이거나 검증 error 가 있으면 정답이라도 **검수불일치(forced)**.
- **신규 분만 승격**하려면 save 결과의 `inserted_id` 스코프로 돌린다.
  교재 전체 `record-review-bulk` 는 **다른 지문의 대기까지** 건드린다.

---

## 5. 보정은 재저장이 아니라 패치

결함을 찾으면 **`updateOne` 으로 해당 필드만 고친다.** 다시 `save` 하면 중복 문항이 쌓인다.

패치 전에 `runPerQuestionValidations` 로 error 0 을 확인하고 적용한다.
`status` 를 대기로 되돌려 pipeline 재검수를 태우면 이력도 남는다.

주문 하나만 다시 보려면 교재 전체(`cc:audit`)는 너무 넓다 —
주문 범위 read-only 도구를 따로 쓴다(§7 표의 `audit-order-grammar-underlines`·`dump-order-questions`).
prevalidate 를 통과한 draft 로 한 문항만 바꿀 때는 `patch-question-data` 를 쓴다.

---

## 6. 자동 검증이 못 잡는 것 — 사람이 본다

여기까지 전부 통과해도 아래는 걸러지지 않는다.

- **고난도 난도** — 무관한문장-고난도의 위장 강도, CEFR 보기의 실제 어휘 난도.
  형식 게이트는 무관 문장이 쉽든 어렵든 통과시킨다. → [AUTHORING.md](AUTHORING.md#만든-뒤-난도를-사람이-다시-본다)
- **해설과 정답의 의미 불일치** — 엑셀 임포트분에서 자주 나온다.
  `CorrectAnswer` 가 맞고 **해설이 틀린** 경우이므로 해설만 다시 쓴다.
- **빈칸 정답 노출** — 정답 표현이 본문 다른 곳에 그대로 남아 있는 경우.
- **도표 지문** — 25번 도표가 주문에 들어와도 전용 처리가 없어 전 유형이 강행 생성된다.

레거시(엑셀 임포트) 문항은 신규 주문 audit 에서 함께 노출된다.
**신규 결함과 섞어 보지 말고 분리해서** 판단한다.

---

## 7. 정답열 패턴 — 이웃 문항의 연속 정답

유형별 PDF 로 나가는 주문은 **인쇄 순서(출처 순)로 같은 정답이 연달아 나오거나(③③)
두 문항씩 같은 패턴으로 반복되면(③④③④)** 학생이 번호 패턴으로 푼다 — 실제로 선생님 항의가 있었다("bca bca - cab cab").
형식 검증은 이것을 전혀 보지 않으므로 **납품 전에 따로 본다.** 대상은 정답이 ①~⑤ 한 개인 유형 전부
(순서·삽입·빈칸·주제 등). 어법-고난도처럼 복수 정답인 유형은 뺀다.

```bash
npm run cc:answer-seq -- check    <주문번호>                                   # 유형별 정답열·분포·연속 반복
npm run cc:answer-seq -- order    <주문번호> [--apply]                         # 순서
npm run cc:answer-seq -- insert   <주문번호> [--lock "…"] [--relaxed] [--apply] # 삽입
npm run cc:answer-seq -- shuffled <주문번호> [--apply]                         # 빈칸·주제 등 셔플형
```

| 유형 | 고치는 방법 | 그대로인 것 |
|---|---|---|
| 순서 | (A)(B)(C) **라벨만** 치환 — 해설의 라벨·보기 인용·번호도 같이 | 본문 덩이·해설 논리. 원문 복원으로 검증 |
| 삽입 | **마커 자리만** 옮김 | 주어진 문장·본문 글자·문장이 들어갈 자리 |
| 셔플형 | 정답 보기와 목표 자리 보기 **두 개만** 맞바꿈 | 보기 문장·해설 논리 |

- **유형당 2문항 이상 주문은 같은 지문 문항끼리도 이웃이다.** 인쇄는 지문마다 N문항씩 붙여 내므로
  한 지문의 두 순서 문항이 같은 순열이면 곧바로 「bca bca」가 된다. 도구는 주문 수량(questionsPerType)만큼 읽어 이것까지 본다.
- **순서는 미리 배정한다.** 병렬 샤드는 서로의 이웃 문항을 모른다(split 은 지문을 라운드로빈으로 나눈다).
  조율자가 인쇄 순서 전체를 보고 지문별 순서 정답을 정해 에이전트에 넘기면 사후 교정이 거의 필요 없다.
- **교정은 검수 전(status 대기)에 한다.** 검수 뒤에 고치면 검수 기록과 본문이 어긋난다.
- 번호가 바뀌면 해설의 조사도 따라간다 — ①이 ②가 ③이 ④가 ⑤가.
- `--apply` 하면 원본이 `.variant-drafts/backups/` 에 남는다.

### 삽입은 사람이 한 번 본다

마커를 옮기면 **새 오답 자리**가 생긴다. 도구는 정답 바로 옆 경계(모호해지기 쉽다)와 글 첫머리(어색하다)를 피하지만,
dry-run 의 `[전]/[후]` 문맥을 읽고 판단한다.

- 작성자가 **모호한 자리를 일부러 비워 둔 문항**(에이전트 보고서에 적힌다)은 `--lock "09회 25번,08회 38번"` 으로 고정한다.
- 해설이 **번호로 언급한 자리가 없어지는 안**은 적용하지 않는다. `--relaxed` 로 돌리면 해설 수기 수정용 초안이
  `.variant-drafts/answer-seq/` 에 떨어진다 → 해설을 고쳐 prevalidate → `patch-question-data` 로 적용.
- 5문장 이하 지문처럼 **모든 경계에 이미 마커가 있으면 옮길 수 없다.** 그래도 겹치면 빼는 문장을 바꿔 문항을 새로 쓴다.
- 적용 전에 dry-run 이 쓴 `.variant-drafts/answer-seq/<주문번호>-insert-*.json` 을 `prevalidate-variants.ts` 로 0 에러 확인한다.

### 함께 쓰는 도구

| 도구 | 용도 |
|---|---|
| `npx tsx scripts/audit-order-grammar-underlines.ts <주문번호>` | 어법: 비정답 밑줄·밑줄 밖 본문이 원문 그대로인지 (read-only) |
| `npx tsx scripts/dump-order-questions.ts <주문번호> <유형> "08회 36번"` | 모호하다고 표시된 문항 전문 보기 |
| `npx tsx scripts/patch-question-data.ts --serial <번호> --json <draft.json>` | prevalidate 한 draft 로 한 문항만 패치 |
| `npx tsx scripts/fix-passage-typo.ts --fix "<pid>\|<틀린 문자열>\|<고친 문자열>"` | 원문 오탈자를 지문과 파생 문항에서 함께 교정 |
| `npm run cc:order-pdf -- <주문번호> [--by round] [--zip]` | 회원 인쇄 양식 PDF(주문번호 폴더) + UTF-8 파일명 zip. `--by round` 는 회차별 통합본 |
