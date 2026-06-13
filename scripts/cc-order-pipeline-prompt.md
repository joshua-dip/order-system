# 주문번호 한 줄 파이프라인 (BV-… / MV-…)

사용자가 채팅에 주문번호(`BV-20260529-002`, `MV-20260401-003` 등)만 입력하면, 아래 흐름을 **묻지 말고** 순서대로 실행한다. Pro-only · Anthropic API 호출 금지.

## 1. 부족·대기 파악 + 대기 자동 검수

```
npm run cc:variant -- pipeline:BV-20260529-002
```

출력의 핵심:
- `counts.pendingReviewTotal` — 대기였던 변형문 수
- `review.completed` · `review.forced_mismatch_by_validation` — 자동 검수 결과
- `counts.needCreateGrandTotal` — 아직 만들어야 할 신규 문항 수
- `next_actions.need_create_by_type[]` — 유형 × 부족 수 × passage_ids 묶음
- `next_actions.empty_passages[]` — 변형 0건 지문

이 단계에서 status=대기 였던 문항들은 자동으로:
1. DB 정답으로 `recordReviewLogFromClaudeCode` 호출
2. per-question 종합 검증 (lib/variant-review-validators.ts) 동시 실행
3. 정답 일치 + 검증 ok → **완료**
4. 검증 error 1건 이상 (해설 누락·어법 모순·보기 중복 등) → **검수불일치 (forced)**

## 2. 신규 생성이 필요하면 — 채팅에서 즉시 작성

`needCreateGrandTotal > 0` 이면 사용자에게 「만들까요?」 묻지 말고 바로 다음을 반복:

```
for each item in next_actions.need_create_by_type:
  for each passage_id in item.passages (필요한 수만큼):
    1) variant_get_passage { passage_id }      # 원문 + 메타
    2) lib/variant-draft-grammar-rules.ts 등 유형별 규칙에 맞춰
       채팅에서 question_data JSON 직접 작성
       (textbook · source · source_key 는 passage 메타와 일치, status:'대기')
    3) variant_save_generated_question { ... }  # DB insert
```

저장 형식 표준 (memory: feedback_variant_question_data_schema.md):
- Paragraph · Question · Options · CorrectAnswer · Explanation
- CorrectAnswer 는 ①②③④⑤ 하나만 (memory: feedback_correct_answer_circled_numbers.md)
- 정식 변형 option_type 은 'English' (shortage 집계 대상). 영어 전용 유형(주제·제목·일치·불일치·함의·빈칸·요약·어휘)은 선택지를 **영어로** 작성. 주장 등 한글 허용 유형은 한글 보기여도 'English'. 'Korean' 은 의도적 한글 버전 전용 (memory: feedback_option_type_always_english.md)
- 순서 Options 5세트 고정 (memory: feedback_order_options_fixed_format.md)
- textbook/source 에 지역명 금지 (memory: feedback_textbook_source_no_region_tag.md)
- 불일치 Options 영어만 (memory: feedback_disagreement_options_english_only.md)
- 어법 해설은 "정답 ④, 나머지는 모두 어법상 옳다" 형태 — 「모두 옳다」 단독 금지 (lib/grammar-explanation-all-correct.ts 가 차단함)

## 3. 신규 저장 후 재검수

새 문항도 status=대기 로 들어가므로 한 번 더:

```
npm run cc:variant -- pipeline:BV-20260529-002 --skip-review false
```

대기가 0 이고 needCreate 도 0 이면 주문 처리 완료. 사용자에게 다음을 보고:

- 자동 검수 완료 N건
- forced_mismatch_by_validation N건 (검증 위반 — 사람 검수 필요)
- 신규 저장 N건
- 남은 신규 작성 0 / 남은 대기 0

## 4. 자주 발생하는 검수불일치 사유 (forced)

`review.forced_mismatch_by_validation > 0` 인 경우, 다음 패턴이 흔하다:

| 검증 규칙 | 사유 |
|---|---|
| `explanation_missing` · `explanation_empty` | 해설 칸이 비어 있음 |
| `explanation_contains_nan` | 'nan' 문자열 누출 |
| `grammar_explanation_all_correct_strong` | 어법 해설이 「모든 밑줄이 맞다」 등 단언 → 정답 없는 문항 |
| `grammar_variant_wrong_slot_equals_original` | 어법 정답 칸 표기가 원문과 같음 (변형 실패) |
| `duplicate_choices_within_question` | 같은 문항 안에 중복 보기 |
| `correct_answer_missing` | CorrectAnswer 비어 있음 |

위 케이스는 자동 수정이 어렵고 사람 또는 채팅 재생성이 필요. `/admin/generated-questions` 의 「전체검수 CLI」 모달에서 카탈로그 확인 가능.

## 5. 금지 사항

- `variant_generate_draft` · `variant_generate_and_save` — Anthropic API 호출 (Pro-only 정책 위반)
- `/api/cron/variant-auto-fill` · `npm run variant:auto-fill`
- 「만들까요?」 「검수할까요?」 등 사용자에게 되묻기 — 파이프라인은 자동 진행
