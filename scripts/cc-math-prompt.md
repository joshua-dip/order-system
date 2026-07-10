# cc:math — VIP 수학 문제은행 작성 규칙 (Pro 전용)

`/my/vip/math-problems` 진도 트리(`lib/math-curriculum.ts`)의 학습주제(topicKey)에 문제를 붙인다.
**API 키 호출 없음** — 채팅에서 문항(문제·정답·풀이)을 직접 작성하고 `cc:math save` 가 검증·저장만 한다.

## 흐름

1. `npm run cc:math -- curricula` — 교과 목록(학교급·주제 수).
2. `npm run cc:math -- topics --textbook "중3-1(22개정)" [--user <U>]` — 리프 topicKey 목록(+보유 수).
   - `--user` 주면 topicKey별 보유 문제 수 병기. `shortage` 는 0개인 주제만.
   - 단축: `npm run cc:math -- "중3-1(22개정)"` → topics.
3. 채팅에서 문항 JSON 작성 → `.math-drafts/<파일>.json`.
4. `npm run cc:math -- save --json draft.json --dry-run` — 검증(0 error 확인).
5. `npm run cc:math -- save --json draft.json` — (userId, topicKey, no) upsert, 신규만 `M-` 일련번호.

## save JSON 스키마

```json
{
  "user": "<email|loginId(전화)|이름>",
  "source": "자체 제작",
  "problems": [
    {
      "topicKey": "중3-1(22개정) > 실수와 그 계산 > 근호를 포함한 식의 계산 > 제곱근의 덧셈과 뺄셈 > 분모의 유리화를 이용한 덧셈과 뺄셈 > 근호 안의 수가 다른 경우의 계산",
      "no": 1,
      "difficulty": "기본",
      "type": "주관식",
      "question": "다음을 간단히 하여라.\n√12 + 6/√3 − √27",
      "answer": "√3",
      "solution": "√12=2√3, 6/√3=2√3, √27=3√3 → 2√3+2√3−3√3=√3"
    }
  ]
}
```

## 규칙

- **topicKey 는 트리와 정확히 일치**해야 클릭 연동됨. `topics` 출력에서 복사하거나, `교과/대단원/중단원/소단원/그룹명/학습주제` 필드로 줘도 CLI 가 조합한다. 불일치면 저장 거부.
- **difficulty**: `기본` | `중` | `고`. **type**: `주관식` | `객관식`.
- **주관식**: `answer` 는 값/식(예: `√3`, `x = −2 ± √10`, `꼭짓점 (3, −4), 최솟값 −4`). `choices` 넣지 말 것.
- **객관식**: `choices` 4~5개(원 번호 제외 텍스트), `answer` 는 `①~⑤` 중 하나(개수 범위 내). 중복 금지.
- **수식 표기**: 유니코드(√ · ² · ½ · ± · ×) 사용(웹/인쇄 공통). LaTeX 금지. 여러 줄은 `\n`.
- **no**: 한 topicKey 안의 표시 순번(정렬용, 생략 시 배열 순서). 같은 (topicKey, no) 재저장은 덮어쓰기.
- 저장 후 `/my/vip/math-problems` 에서 해당 주제 칩에 보유 수 배지 + 우측 목록/인쇄로 확인.

## 금지

- 웹/서버에서 Anthropic API 로 문제 생성(과금). CLI `save` 만 사용.
- topicKey 를 임의로 지어내기(트리에 없으면 클릭해도 안 뜬다).
