# 변형문제 자동 채움 워크플로우 (Pro 전용 · /loop · ScheduleWakeup)

> Claude Code (Pro) 채팅에 이 문서를 첨부하고 **주문번호** 또는 **교재명**을 전달하면 한 cycle 을 자동 실행한다.
> **API 키 호출 없음** — `lib/admin-variant-draft-claude.ts` / `lib/variant-draft-grammar-rules.ts` / `lib/variant-draft-blank-summary-rules.ts` 의 규칙에 따라 채팅에서 `question_data` JSON 을 작성하고 `cc:variant save` 만 사용한다.

---

## 입력 (호출 방법)

사용자가 한 줄로 호출:

```
@scripts/cc-variant-loop-prompt.md 워크플로우대로 주문 "BV-20260601-001" 1 cycle 돌려줘 (seed=session-A).
```

- 첫 번째 인자: 주문번호 (`BV-…`, `MV-…`) **또는** 교재명 (`"Booster 어법어휘"`).
- `seed=<문자열>` (선택) — 병렬 세션 분산용 시드. 한 세션은 같은 시드를 계속 쓰지 말고 매 cycle 새로 만들어도 됨 (`session-A-1`, `session-A-2` …). 시드가 없으면 매 cycle Math.random() 으로 슬롯을 고른다.

---

## 실행 순서 (반드시 이 순서)

### 1. 다음 작성 슬롯 받기

```
npm run cc:variant -- next-empty --order-number "BV-20260601-001"
```

(교재명이면 `--textbook "교재명"`. 시드 쓰려면 `--seed "session-A-3"`.)

응답 JSON 을 보고 분기:

### 2. 응답이 `{ok:true, done:true}` 이면

- 사용자에게 **「<order/textbook>」 자동 채움 완료** 메시지 전송.
- **ScheduleWakeup 호출하지 말고** 종료.

### 3. 응답이 `{ok:true, done:false, next:{…}}` 이면

응답 예:
```jsonc
{
  "ok": true,
  "done": false,
  "textbook": "Booster 어법어휘",
  "counts": { "totalSlotsLeft": 352, "typesChecked": ["주제", …], "requiredPerType": 3 },
  "next": {
    "passage_id": "6a1d…",
    "type": "빈칸",
    "shortBy": 3,
    "label": "UNIT 10 03번",
    "source_key": "UNIT 10 03번",
    "chapter": "UNIT 10",
    "number": "03번",
    "passage": {
      "textbook": "Booster 어법어휘",
      "source_key": "UNIT 10 03번",
      "content": { "original": "...", "translation": "...", "sentences_en": [...], "sentences_ko": [...] }
    }
  }
}
```

#### 3a. 유형별 규칙 로드

`lib/admin-variant-draft-claude.ts` 의 `buildVariantDraftSystemPrompt` 텍스트(공통 규칙 1)~6) + 유형별 규칙)에 따라 작성한다. 빈칸/요약은 `lib/variant-draft-blank-summary-rules.ts`, 어법/어법-고난도는 `lib/variant-draft-grammar-rules.ts` 의 단계 A~K 도 모두 적용.

핵심 사항 요약 (모든 유형 공통):

- 키: `Question`, `Paragraph`, `Options`, `OptionType`("English"), `CorrectAnswer`, `Explanation`, `NumQuestion`, `Source`(보통 ""), `Category`(보통 "").
- `Options`: **5개 보기를 한 문자열**로 `###` 구분. 객체 금지.
- `OptionType`: 정식 변형은 `"English"` (shortage 집계 대상). 영어 전용 유형(주제·제목·일치·불일치·함의·빈칸·요약·어휘)은 보기를 **영어로** 작성하고 `English`. 주장 등 한글 허용 유형은 한글 보기여도 `English`. 의도적 한글 버전을 따로 만들 때만 `Korean` (memory: feedback_option_type_always_english.md).
- `CorrectAnswer`: `①②③④⑤` **동그라미 번호 하나만** (어법-고난도만 `①③` 같은 2~3개 연속). 아라비아 숫자 금지 (memory: feedback_correct_answer_circled_numbers.md).
- 정답 위치는 ① 한 자리에 치우치지 말 것 (memory: feedback_correct_answer_distribution.md).
- `Explanation`: 한국어 450자 이하, 결론 하나만 명확히.

유형별 핵심:

- **주제·제목·주장·일치·불일치**: `Paragraph` 는 원문 그대로(`<u>` 금지). Options 5개 영어 명사구/문장, 각 8~15단어.
- **빈칸**: `Paragraph` 에서 정답 구절 한 곳만 `<u>_____</u>` 처리(밑줄 5개 표시 + 본문 빈칸 1개). Options 5개 영어. 자세히는 `lib/variant-draft-blank-summary-rules.ts` 참조.
- **요약**: `lib/variant-draft-blank-summary-rules.ts` 참조 — `(A)`/`(B)` 두 빈칸 + 5개 보기는 `(A) word ### (B) word` 형식.
- **순서**: `Paragraph` 는 (1) 주어진 문장 한 줄, (2) (A)/(B)/(C) 세 블록 — 올바른 순서 뒤섞기. Options 5개 고정: `① (A)-(C)-(B) ### ② (B)-(A)-(C) ### ③ (B)-(C)-(A) ### ④ (C)-(A)-(B) ### ⑤ (C)-(B)-(A)` (memory: feedback_order_options_fixed_format.md).
- **삽입**: `Paragraph` 는 (1) 주어진 문장 한 줄, (2) **빈 줄**, (3) 본문 — 본문에 ①②③④⑤ 위치 표시. Options `① ### ② ### ③ ### ④ ### ⑤`.
- **무관한문장**: 원문 사이에 주제와 완전히 무관한 문장 한 개 끼우기. 첫 문장 번호 없이 두번째부터 ①②③④⑤. Options `① ### ② ### ③ ### ④ ### ⑤`.
- **어법**: `Paragraph` 는 원문 그대로 + 5곳 `<u>…</u>` 밑줄 (각 1~3 단어). 한 곳만 `wrongForm`, 나머지 4곳은 원문 그대로의 올바른 표현. 동그라미는 `<u>` 밖, 번호와 `<u>` 사이 공백 1칸: `③ <u>표현</u>`. Options 고정 `①###②###③###④###⑤`. CorrectAnswer 는 wrongForm 위치. Explanation 은 "③ 가 정답입니다."처럼 시작 + correctForm/wrongForm 대비.

#### 3b. `shortBy` 개의 question_data JSON 작성

`next.shortBy` (보통 3) 개의 **서로 다른** 문항을 만든다 — 같은 (passage, type) 조합이지만 매번 정답 위치·정답 보기·오답 보기를 다르게.

각 문항을 `.variant-drafts/<sourceKey_slug>__<type>__<seed>_<i>.json` 에 저장 (slug: 한글/공백을 `_` 로):

```jsonc
{
  "passage_id": "6a1d...",
  "textbook": "Booster 어법어휘",
  "source": "UNIT 10 03번",
  "type": "빈칸",
  "status": "대기",
  "option_type": "English",
  "question_data": {
    "NumQuestion": 1,
    "순서": 1,
    "Source": "",
    "Category": "",
    "Question": "다음 빈칸에 들어갈 말로 가장 적절한 것은?",
    "Paragraph": "...본문에 <u>_____</u> 한 곳...",
    "Options": "① ... ### ② ... ### ③ ... ### ④ ... ### ⑤ ...",
    "OptionType": "English",
    "CorrectAnswer": "③",
    "Explanation": "③ 가 정답입니다. ..."
  }
}
```

#### 3c. 각 JSON 저장

```
npm run cc:variant -- save --json .variant-drafts/<file>.json
```

또는 stdin (코드펜스 자동 제거):

```
cat .variant-drafts/<file>.json | npm run cc:variant -- save --json -
```

`{ok:true, saved:{insertedId:"…"}}` 면 성공. 실패 메시지가 나오면 그 내용 그대로 사용자에게 보고 후 `result:` 마치고 `ScheduleWakeup` 호출하지 말 것 (사람 개입 필요).

### 4. 다음 cycle 예약

성공적으로 `shortBy` 개를 저장했으면:

```
ScheduleWakeup({
  delaySeconds: 60,
  reason: "next variant cycle for <order/textbook>",
  prompt: "@scripts/cc-variant-loop-prompt.md 워크플로우대로 주문 \"BV-20260601-001\" 1 cycle 돌려줘 (seed=session-A-<n+1>).",
})
```

`delaySeconds` 는 60~120 범위로. 더 빨리 돌리고 싶으면 60.

---

## 금지 사항

- `variant_generate_draft` / `variant_generate_and_save` (Anthropic API)
- `/api/admin/generated-questions/generate-draft` 라우트
- `/api/cron/variant-auto-fill` · `npm run variant:auto-fill`
- 「만들까요?」 「저장할까요?」 류 되묻기 — 워크플로우는 자동 진행

## 흔한 오류

- **Options 객체로 출력** → 반드시 문자열 한 줄로 `###` 구분.
- **CorrectAnswer 에 아라비아 숫자** → `①②③④⑤` 중 하나만 (어법-고난도는 예외).
- **textbook/source 에 (부산)·(서울) 등 지역 태그** → 금지. `passage.source_key` 그대로.
- **모든 정답을 ①** → 분산할 것. 저장 시 서버가 추가 보정하지만 작성 단계에서도 임의로.
- **어법 Explanation 에 "모두 옳다" 단언** → `lib/grammar-explanation-all-correct.ts` 가 차단. "정답 ③, 나머지는 모두 어법상 옳다" 형식 OK.
