# 변형문제 작성 가이드라인

객관식 변형문제(`generated_questions`)를 채팅에서 직접 작성해 저장할 때의 규칙.
Pro 플랜만 쓰는 운영이라 초안 생성 API(`variant_generate_draft` 등)는 호출하지 않는다 —
지문만 받아 **사람·모델이 채팅에서 JSON 을 작성**하고 CLI 로 저장한다.

## 규칙이 어디에 있나

| 위치 | 성격 |
|---|---|
| [`lib/admin-variant-draft-claude.ts`](../../lib/admin-variant-draft-claude.ts) `buildVariantDraftSystemPrompt` | **권위** — 공통 규칙 + 유형별 규칙 원본 |
| [`lib/variant-draft-blank-summary-rules.ts`](../../lib/variant-draft-blank-summary-rules.ts) | 빈칸·요약 상세 |
| [`lib/variant-draft-grammar-rules.ts`](../../lib/variant-draft-grammar-rules.ts) | 어법 단계 A~K |
| [`app/data/variant-type-guides.ts`](../../app/data/variant-type-guides.ts) `ADVANCED_NOTES` | 고난도 유형별 난도 기준 |
| [`scripts/cc-variant-loop-prompt.md`](../../scripts/cc-variant-loop-prompt.md) | 자동 채움 루프 절차 |
| [`scripts/cc-order-pipeline-prompt.md`](../../scripts/cc-order-pipeline-prompt.md) | 주문 한 줄 파이프라인 절차 |
| **이 문서** | 위 코드에 안 적힌 **실전 교정 규칙** — 실제로 틀렸던 것들 |

코드와 이 문서가 어긋나면 **코드가 맞다.** 이 문서는 코드가 강제하지 못하는(= 검증을 통과하지만
결과물이 잘못되는) 부분을 모은 것이다.

---

## 공통 스키마

```jsonc
{
  "passage_id": "6a1d…",
  "textbook": "Booster 어법어휘",
  "source": "UNIT 10 03번",
  "type": "빈칸",
  "status": "대기",
  "option_type": "English",
  "question_data": {
    "NumQuestion": 1,
    "Source": "",
    "Category": "",
    "Question": "다음 빈칸에 들어갈 말로 가장 적절한 것은?",
    "Paragraph": "…",
    "Options": "① … ### ② … ### ③ … ### ④ … ### ⑤ …",
    "OptionType": "English",
    "CorrectAnswer": "③",
    "Explanation": "③ 가 정답입니다. …"
  }
}
```

- `Options` 는 **5개 보기를 한 문자열**로. 객체·배열 금지.
- `Explanation` 은 한국어 450자 이하, 결론 하나만.
- `Source`·`Category` 는 보통 빈 문자열. 지역명(`(부산시)` 등)을 `textbook`/`source` 에 붙이지 말 것 —
  `passages.source_key` 와 정확히 일치해야 매칭된다.

### `###` 는 노이즈가 아니다

`###` 는 **보기 구분자**이자 순서·삽입 유형의 **블록 구분자**다. 저장 콘텐츠에서 지우면 안 된다.
레거시 데이터에는 줄바꿈으로 구분된 보기도 많아, 읽는 쪽은 둘 다 받아야 한다
([`lib/question-options-segments.ts`](../../lib/question-options-segments.ts) `splitQuestionOptionSegments`).

---

## CorrectAnswer

- **`①②③④⑤` 동그라미 하나만.** 아라비아 숫자·괄호 표기 금지.
- 함의·요약처럼 `(A)`/`(B)` 가 나오는 유형도 CorrectAnswer 는 동그라미 하나. `(A)`/`(B)` 는 Options 안에서만.
- **예외 — 어법-고난도·어휘-고난도**(모두 고르기): 동그라미 **2~5개를 ①→⑤ 순서로 연속** 표기.
  공백·쉼표 없이 `"①③"`, `"②③⑤"`. 저장 시 `normalizeGrammarHardCorrectAnswer` 가 정렬·중복 제거하고,
  채점은 집합 비교라 순서는 무관하지만 입력부터 정렬해 둔다.

### 정답 위치 분포

①에 몰리지 않게 작성한다. 다만 **셔플 여부에 따라 의미가 다르다.**

- **셔플 O 유형**(빈칸·요약·함의 등): 저장 시 `shuffleQuestionDataForDistribution` 가 무작위로 섞으므로
  작성 단계에서 위치를 맞춰도 소용없다.
- **셔플 X 유형**(순서·삽입·어법·무관한문장): 정답이 본문 구조에 묶여 있어 **작성자가 직접 분산**해야 한다.
  특히 순서는 방치하면 ③④에 쏠린다 — 원문을 연속 세 덩이로 자른 뒤 `(A)(B)(C)` **라벨 배치만** 바꿔
  ①②⑤도 만든다.

주문 단위 진단: `npx tsx scripts/diagnose-order-answer-distribution.ts <주문번호>`

---

## option_type

정식 변형은 **`"English"`** 로 저장한다. shortage 집계 대상이 이 값이다.

- 영어 전용 유형(주제·제목·일치·불일치·함의·빈칸·요약·어휘)은 보기를 **영어로** 쓰고 `English`.
- 주장처럼 한글 보기가 관행인 유형도 `English` 로 둔다.
- **`"Korean"` 은 의도적으로 한글 버전을 따로 만들 때만.** 영어 세트와 공존하는 별도 산출물이다.

> ⚠️ 정합 검증 `hangul_options_in_english_type` 은 **`English` 인데 한글인 것만** 결함으로 본다.
> `Korean` 을 영어로 일괄 변환하면 의도한 한글 버전을 망친다. 예전에 이 오탐으로
> "한글 9,108건 결함" 이 나왔지만 실제는 296건이었다.

---

## 유형별 형식

### 주제 · 제목 · 주장 · 일치 · 불일치

`Paragraph` 는 **원문 그대로**(`<u>` 금지). Options 5개, 각 8~15단어.
**불일치는 영어 진술문만** — 한글 선택지를 쓰지 않는다.

### 빈칸

`Paragraph` 에서 정답 구절 한 곳만 `<u>_____</u>`. 본문 빈칸은 **1개뿐**.
정답 표현이 본문 다른 곳에 그대로 남아 있으면 안 된다(정답 노출).

### 요약

`(A)`/`(B)` 두 빈칸 + 보기 5개는 `(A) word - (B) word` 쌍.

> **가장 흔한 사고**: 요약문을 `Explanation` 이나 발문에만 쓰고 **`Paragraph` 에 빠뜨리는 것.**
> `Paragraph` 는 `본문\n\n→ … (A) ________ … (B) ________ …` 형태로, **요약문이 본문 아래**에 와야 한다.
> 본문 위에 붙이는 것도 결함으로 잡힌다. 이 결함은 per-question 검증을 **통과**하므로
> `cc:audit` 의 `summaryStructure` 로만 잡힌다. → [REVIEW.md](REVIEW.md)

### 순서

`Paragraph` = (1) 주어진 문장 한 줄, (2) `(A)`/`(B)`/`(C)` 세 블록.
**블록 구분은 `\n###\n` 또는 빈 줄** — 단일 `\n` 이면 `parseOrderParagraph` 가 실패해 자동 정답검증이 안 된다.

Options 는 **아래 5순열 고정**이며 **줄바꿈으로 구분**한다.

```
① (A)-(C)-(B)
② (B)-(A)-(C)
③ (B)-(C)-(A)
④ (C)-(A)-(B)
⑤ (C)-(B)-(A)
```

> 관리자 검증기(`app/api/admin/generated-questions/validate/order-options`)가 Options 를
> `\n` 으로만 split 해 길이 5를 본다. `###` 한 줄로 넣으면 길이 1로 읽혀 「수정 대상」이 된다.
> JSON 에서는 `"① (A)-(C)-(B)\n② (B)-(A)-(C)\n…"`.

### 삽입

`Paragraph` = (1) 주어진 문장 한 줄, (2) **빈 줄**, (3) 본문(①②③④⑤ 위치 표시).
Options `① ### ② ### ③ ### ④ ### ⑤`.

**마커는 정확히 5개.** 지문이 짧으면 여기서 막힌다.

- **5문장 이하**: 추출형 불가. 문장을 빼지 말고 **전체를 본문에 두어 마커 5개**를 만들고,
  주어진 문장은 원문에 없는 **새 브릿지 문장**으로 쓴다(지시어·연결어로 앞 문장을 받아 한 위치에만 맞게).
- **6문장**: base 추출형은 **5개까지만** 가능(S2~S6 제거. S1 은 ① 앞이라 불가).
  더 필요하면 나머지는 브릿지 문장으로 채운다.

마커 개수는 per-question 검증에 **없고** `cc:audit` 에만 있다. 삽입 작성 후 반드시 audit 을 돌린다.

### 무관한문장

원문 사이에 무관한 문장 하나를 끼운다. 첫 문장은 번호 없이, 두 번째부터 ①②③④⑤.
Options `① ### ② ### ③ ### ④ ### ⑤`.

### 어법

`Paragraph` 는 원문 그대로 + **5곳** `<u>…</u>`(각 1~3 단어). 한 곳만 틀린 형태, 나머지 4곳은 원문 그대로.
동그라미는 `<u>` **밖**, 번호와 `<u>` 사이 공백 1칸: `③ <u>표현</u>`.
Options 고정 `①###②###③###④###⑤`. Explanation 은 `"③ 가 정답입니다."` 로 시작 + 옳은 형태/틀린 형태 대비.

> 밑줄 **밖** 텍스트는 원문과 바이트 단위로 같아야 게이트
> (`wrong_slot_equals_original` / `non_wrong_slot_differs_from_original`)를 통과한다.
> 수십 문항을 손으로 복붙하면 반드시 깨진다 — **원문을 한 상수로 두고 파생**할 것.

해설에 "나머지는 모두 옳다" 류를 쓰면 `detectAllCorrectClaim` 경고가 뜬다.
**「나머지」·「그 외」·「이외」** 같은 잔여 한정어를 넣으면 정상 처리된다.

### 어휘 · 어휘-고난도

Options 는 **`① word ### ② word ### …` — 번호 필수, 단어만.**

- **괄호 맥락 금지**: `① extensive (due to its extensive usage)` 처럼 본문 맥락을 붙이지 않는다.
  수능형이 아니고 정답 단서를 노출한다.
- **번호를 빼면 안 된다**: 맨 단어(`simplified ### useful …`)로 저장해도 저장·사전검증은 통과하지만,
  렌더러 `optionsLineForChoice` 가 보기를 ①~⑤ 로 못 찾아 **정답 표시가 깨진다.**
  실제로 병렬 에이전트가 어휘-고난도 15/36 을 이렇게 저장해 사후 보정했다.

---

## 고난도 13종

`ADVANCED_VARIANT_TYPES` — 전부 80원. 발문은 base 와 같고 **내용 난도만** 올린다.

| 유형 | 메커니즘 | 정답 | Options | 저장 셔플 |
|---|---|---|---|---|
| 삽입-고난도 | 단서 약화 | 단일 | 위치번호 | X |
| 어법-고난도 | 모두 고르기 | **복수** | 번호만 | X |
| 빈칸-고난도 | 추론 | 단일 | 긴 구·절 영어 | **O** |
| 어휘-고난도 | 모두 고르기 | **복수** | 단어(괄호 없이) | X |
| 순서-고난도 | 단서 약화 | 단일 | 고정 5순열 | X |
| 요약-고난도 | 상위어 추론 | 단일 | `(A) w - (B) w` | **O** |
| 무관한문장-고난도 | 주제어 위장 | 단일 | 위치번호 | X |
| 함의-고난도 | 비유·반어 추론 | 단일 | 영어 의미진술 | **O** |

**CEFR 5종**(주제·제목·주장·일치·불일치 -고난도)은 형식이 아니라 **선택지 어휘 난도(C2~C3)** 로 고난도화한다.
모두 단일정답·셔플 O. **주장-고난도만 base 와 달리 영어 선택지**를 쓴다(CEFR 성립을 위해).
해설 끝에 `[고난도 어휘] 단어: 뜻 (유의어: …)` 글로싱을 넣는다.

### 만든 뒤 난도를 사람이 다시 본다

자동 검증은 **구조만** 보고 난도는 못 잡는다. 형식 통과로 끝내지 말 것.

- **무관한문장-고난도**: 무관 문장이 지문의 **핵심 어휘·소재를 공유**하되 논지에서만 벗어나야 한다.
  토성·해구·은하처럼 **완전히 무관한 문장은 base 급**이다. (양육 지문이면 parents/children/food 를 쓰되
  취침습관·미각 같은 곁가지 사실로.)
- **CEFR 5종**: 글로싱이 가리키는 어려운 단어가 **선택지 본문에 실제로** 있어야 한다.
  글로싱만 어렵고 보기는 평이하면 미달이다.

---

## 무료 7종

주제·제목·주장·일치·불일치·순서·삽입은 **회원 여부와 무관하게 0원**이다(`FREE_VARIANT_TYPES`).
품질 이슈가 있어 홍보용으로 무료화한 것이고, 매출은 고난도(80원)에서 낸다.
**되돌리자고 제안하지 말 것.** 유료 유형을 하나 이상 고른 주문에만 덤으로 붙는다.

---

## 저장

```bash
npm run cc:variant -- save --json .variant-drafts/<파일>.json
```

- **`save` 에는 dry-run 이 없다.** `--dry-run` 을 붙여도 무시하고 즉시 insert 된다.
- **미지원 플래그를 붙여 재호출하면 그대로 다시 insert 된다** — 실제로 64건이 중복 저장된 적이 있다.
  `| head -1` 로도 못 막는다(insert 가 출력보다 먼저 끝난다). **save 는 한 번만.**
- 저장 전에 오프라인 검증을 돌린다:

```bash
npx tsx scripts/cc-variant-prevalidate.ts <draft.json>
```

**ERROR 0 · warning 0** 을 확인하고 저장한다. → 나머지는 [REVIEW.md](REVIEW.md)
