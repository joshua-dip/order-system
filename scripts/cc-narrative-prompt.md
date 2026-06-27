# 서술형 변형(narrative_questions) Pro 전용 생성 워크플로우 (cc:narrative)

> 객관식 변형(cc:variant)과 동일한 Pro 전용 방식 — **API 키 호출 없음**.
> 채팅에서 `question_data` JSON 작성 → `cc:narrative save` 가 검증·insert.
> `/admin/generated-questions?mode=essay` (= `narrative_questions`) 에서 조회됩니다.
> 작성분은 `source_file='claude-code'` 마커로 엑셀 임포트 curated 분과 구분됩니다.

## 흐름

1. `npm run cc:narrative -- shortage --textbook "교재명"` — (지문×subtype) 부족분 파악
2. `npm run cc:narrative -- passage --id <passageId>` — 원문 + 기존 서술형 + 지원 subtype
3. 채팅에서 아래 규칙대로 `question_data` JSON 작성 → `.narrative-drafts/<slug>.json`
4. `npm run cc:narrative -- save --json <file> --dry-run` — 검증 통과 확인
5. `npm run cc:narrative -- save --json <file>` — narrative_questions insert

## 지원 subtype (현 DB 보유 3종)

### 빈칸재배열형(A+B·주제·Hard) / 빈칸재배열형(A+B·어법·Hard)
`<보기>` 단어들을 문맥에 맞게 재배열해 빈칸 (A)를 영작하는 유형.
- `점수`: 4
- `문제`: "아래글의 빈칸 (A)에 들어갈 말을 <보기>에 주어진 단어들을 문맥에 맞게 재배열하여 영작하시오. [4점]"
- `본문`/`완전한문제`: 본문에 빈칸 `(A)` 표식 + `<보기>` 단어 목록 포함
- `원문`: 변형 전 원문
- `키워드`: `<보기>` 단어들을 ` / ` 로 구분 (구두점 포함, 모범답안과 **같은 형태**)
- `키워드개수` = `답안단어수` = 단어 수
- `모범답안`: 정답 어순 (공백 구분). **키워드와 단어 멀티셋이 정확히 일치해야 함** (검증기 강제)
- `해설`: 어순·어법 근거 (한국어, 600자 이하)
- 주제형은 주제 흐름, 어법형은 어법(수동태·분사·병렬 등) 초점

### 이중요지영작형
지문의 두 핵심을 각각 영어로 서술하는 자유 영작.
- `점수`: 8
- `문제`: "[서술형] … write an answer that explains:" 형태의 안내
- `본문`: `(1) <u>과제1</u>`, `(2) <u>과제2</u>` **두 개의 `<u>…</u>` 과제** + "Write your answer in N - M English words." + 지문
- `완전한문제`: 위 + `[모범 답안]` 포함
- `모범답안`: N-M 단어 범위 내 영어 답안
- `답안단어수`: 실제 단어 수 (범위 내)
- `해설`: 평가 포인트 (한국어)

### 주제완성형
**주어진 어구를 변형 없이 활용**해 글의 주제를 **명사구**로 완성하는 영작 (예: `the historical pursuit of ____`).
- `점수`: 5
- `문제`: "주어진 글 속의 어구를 활용하여, 다음 글의 주제를 완성하시오. [5점]"
- `본문`/`원문`: 지문 원문(변형 없음 — 동일하게)
- `주제틀`: 빈칸 **앞**에 제시되는 어구 (예: "the historical pursuit of"). 학생이 이 뒤를 채운다.
- `주어진표현`: 빈칸에 **반드시 변형 없이** 넣을 어구들, ` / ` 로 구분 (예: "machines / creating / like humans")
- `최소단어수`: 6 (조건 ②)
- `모범답안`: 빈칸을 채우는 **명사구** — `주어진표현`을 모두(변형 없이) 포함, `최소단어수` 이상 (예: "creating machines that think like humans")
- `완전한문제`: `주제틀` + ' ' + `모범답안` (예: "the historical pursuit of creating machines that think like humans")
- `답안단어수`: 모범답안 실제 단어 수
- `조건`: "① 빈칸에 다음의 표현들을 반드시 이용하시오.(변형불가)\n② 위 표현들을 포함하여 6단어 이상으로 답안을 작성하시오.\n③ 완성된 주제가 명사구의 형태가 되도록 답안을 작성하시오."
- `해설`: 주제 흐름 근거 (한국어)
- **검증 강제**: 주어진표현이 모범답안에 모두 포함 + 답안 `최소단어수` 이상. (명사구·정합은 경고)

### 요약문빈칸완성형
지문을 **한 문장으로 요약**한 글에 빈칸 `(A)(B)(C)…` 를 두고, **지문 속 단어를 그대로** 단어 수에 맞춰 채우는 유형.
- `점수`: 5
- `문제`: "다음 글의 내용을 한 문장으로 요약하고자 한다. 빈칸 (A)~(C)에 적절한 말을 넣어 요약문을 완성하시오. [5점]"
- `본문`/`원문`: 지문 원문
- `요약문`: 빈칸 `(A)`,`(B)`,`(C)` 표식이 든 한 문장 요약 (예: "Unlike the notion that only people with a (A) are under stress, …")
- `빈칸들`: `[{ "기호":"A", "단어수":3, "답":"lower socioeconomic status" }, …]` — 각 빈칸의 단어 수와 정답
- `완전한문제`: 빈칸을 채운 완성 요약문, `모범답안`: `(A) … / (B) … / (C) …` 형태
- `조건`: "① 각 답란 (A)~(C)에 제시된 단어 수와 일치되게 쓸 것\n② 지문에서 단어를 찾아 그대로 적을 것\n③ 지문에 없는 단어를 쓸 경우 감점함"
- `해설`: 요약 근거 (한국어)
- **검증 강제**: 각 빈칸 답 단어 수 = 제시 단어 수, 답의 모든 단어가 **본문에 그대로** 존재(없으면 error). 연속 구 미존재는 경고. (하이픈 결합어 `time-poor` 는 1단어)

## save JSON 형식

```jsonc
{
  "passage_id": "69ce8dbc46f58f933b6dcf6d",
  "narrative_subtype": "빈칸재배열형(A+B·주제·Hard)",
  "question_data": {
    "번호": "01번", "강": "01강", "문제유형": "빈칸재배열형(A+B·주제·Hard)", "점수": 4,
    "문제": "아래글의 빈칸 (A)에 들어갈 말을 <보기>에 주어진 단어들을 문맥에 맞게 재배열하여 영작하시오. [4점]",
    "본문": "...본문에 (A) 표식... <보기>: give / and / messages / certain",
    "완전한문제": "...전체...###[모범답안]### and give certain messages",
    "원문": "...변형 전 원문...",
    "키워드": "give / and / messages / certain",
    "키워드개수": 4,
    "모범답안": "and give certain messages",
    "답안단어수": 4,
    "해설": "어순·근거 설명."
  }
  // textbook·chapter·number 는 passage 메타로 자동 보강. status 기본 '대기'.
}
```

## 금지
- `/api/variant/essay-generate`, `/api/my/member-variant/essay-generate` (Anthropic API, `x-anthropic-api-key` 필요) — Pro 전용 운영 시 호출 금지.
- cc:narrative `save` 만 사용 (검증 + insert, API 無).
