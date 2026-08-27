# 요지 조건영작배열 — ExamData 작성 규칙

학교 기출 서술형 5~6번 형태. **`<보기>` 단어를 주어진 순서대로 모두 한 번씩 써서
글의 요지를 영어 한 문장으로 영작**하는 유형이다.

- 출제기: `/admin/essay-generator/main-idea`
- `meta.examType` = **`일반요지요약형`** (이 값이 있어야 검증·HTML·부록이 요지형으로 분기한다)
- `meta.difficulty` = **`기본난도`** (난도를 나누지 않는다)
- 한 지문에 **1문항**. 배열형처럼 두 문장을 뽑지 않는다.

배열형(`generation_prompt.md`)과 헷갈리기 쉬운 지점부터 적는다.

| | 배열형 | **요지형** |
|---|---|---|
| `bogi` 순서 | 섞어서 제시 (학생이 정렬) | **정답 순서 그대로** (순서가 힌트) |
| `bogi` 합 | = `answer.text` 와 정확히 일치 | 정답의 **뼈대만**. 보조어는 학생이 채움 |
| 문항 수 | 한 지문 2문항 | 한 지문 **1문항** |
| 난도 | 4단계 | 기본난도 하나 |

---

## 스키마

```json
{
  "meta": {
    "title": "영어 서·논술형 평가",
    "examType": "일반요지요약형",
    "difficulty": "기본난도",
    "subtitle": "...",
    "info": [...]
  },
  "question_set": { "tag": "서·논술형", "instruction": "다음 글을 읽고 물음에 답하시오." },
  "passage": "<지문 원문>",
  "questions": [
    {
      "id": "1",
      "points": 5,
      "prompt": "다음 글의 요지를 <보기>에 주어진 단어만 모두 한 번씩 순서대로 사용하여 10단어 이상 20단어 이내의 완전한 형식의 영어 문장으로 영작하시오. (단, 어형변화 금지, 철자 오류 시 오답 처리, 부분 점수 있음)",
      "conditions": [
        "① <보기>의 단어를 모두 한 번씩, 주어진 순서대로 사용할 것",
        "② 어형 변화 금지 (주어진 형태 그대로 쓸 것)",
        "③ 10단어 이상 20단어 이내의 완전한 문장으로 쓸 것",
        "④ 철자 오류 시 오답 처리, 부분 점수 있음"
      ],
      "bogi": "teachers / unconscious / bias / lowers / girls / math / scores",
      "answer": {
        "text": "Teachers' unconscious bias lowers girls' math scores even when their actual ability is higher.",
        "word_count": { "total": 14, "words": ["Teachers'", "unconscious", "..."] }
      },
      "explanation": "..."
    }
  ]
}
```

## bogi — `<보기>`

- 정답 문장의 **뼈대 단어만** 5~12개, 슬래시(` / `)로 구분.
- **정답에 나오는 순서 그대로** 나열한다.
- 관사·전치사·be동사·접속사 같은 보조어는 **넣지 않는다**. 학생이 채워 넣는 몫이다.
- 지문의 표현을 쓰되 요지를 압축한 **주제어**를 고른다.
- `/` 는 구분자다. 보기 안에 `/` 가 들어가는 표현은 쓰지 말 것
  (`and/or` 같은 것 — [[project_essay_bogi_no_slash]] 와 같은 이유).

## answer.text

- `<보기>` 단어가 **모두 · 순서대로 · 한 번씩** 들어간 영어 **한 문장**.
- 보조어는 자유롭게 더한다. **소유격 아포스트로피는 허용**
  (`teachers` → `Teachers'`, `girls` → `girls'`). 그 외 어형 변화는 금지.
- 단어 수는 `prompt` 의 범위(기본 10~20) 안. `word_count.total` 과 일치해야 한다.
- 같은 보기 단어를 정답에서 두 번 쓰지 말 것 (채점이 흔들린다).

## explanation

1. 글의 요지를 우리말 한 문장으로 먼저 밝힌다.
2. 지문의 어느 근거에서 나오는지 댄다.
3. `<보기>` 순서를 뼈대로 문장을 어떻게 세우는지 짚는다.
   예: `teachers → unconscious bias(주어) → lowers(동사) → girls math scores(목적어)`,
   단어 수를 맞추려 뒤에 부사절을 덧붙인다.

---

## 검증이 잡는 것 (`lib/essay-exam-validator.ts`)

저장 전 `save --dry-run` 으로 확인한다. **error 는 저장을 막는다.**

| 검사 | 결과 |
|---|---|
| `<보기>` 단어가 정답에 없음 | **error** — 누락된 단어를 알려 준다 |
| `<보기>` 순서가 정답과 다름 | **error** — 어긋난 단어를 알려 준다 |
| 정답이 영어가 아님 | **error** |
| `<보기>` 3개 미만 | **error** |
| 단어 수가 조건 범위 밖 | **error** |
| `answer.text` 단어수 ≠ `word_count.total` | **error** |
| 같은 보기 단어를 두 번 사용 | warning |
| `<보기>` 5~12개 범위 밖 | warning |
| `conditions` 3~5줄 범위 밖 | warning |

## 저장

```bash
npm run cc:essay -- save --json draft.json --dry-run   # 검증만
npm run cc:essay -- save --json draft.json             # essay_exams 에 insert
```

`/admin/essay-generator/main-idea` 의 「📂 목록」에서 바로 보인다.
