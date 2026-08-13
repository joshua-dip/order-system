# 국어 해설지 작성 규칙 (Pro 채팅 전용)

> 이 문서는 Claude Pro 채팅에서 `cc:korean-explain save` 로 넘길 **블록 JSON** 을 만들 때 따르는 규칙. API 호출 0, 데이터는 사람·Claude 가 직접 작성한다.

## 0. 원칙

1. **비문학 우선.** 본 PR(#1~#5) 의 1차 운영 대상은 독서(인문·사회·과학·예술)·화법/작문·문법. 문학(현대소설/현대시/고전시가/고전소설) 은 외부 정리물 import 가 결정된 뒤 별도 epic.
2. **갈래 분기 금지.** 같은 13종 블록을 **데이터 조합**으로 흡수한다. 코드에 `if (genre === ...)` 가 생기지 않도록 데이터만 다르게 짠다.
3. **디자인 변경 금지.** `lib/korean-explainer/styles.css` 는 검증 완료 자산. 새 갈래가 와도 블록 1종을 추가하는 수준에서 끝낸다.
4. **API 호출 0.** `/api/admin/korean-explainer/generate` 라우트는 만들지 않는다. 모든 블록은 채팅·CLI 만으로 작성·저장.

## 1. JSON 전체 구조

```jsonc
{
  "textbook":     "2025학년도 3월 고1 국어 모의고사",
  "sourceKey":    "25-03-go1-22-25",
  "setRange":     "22-25",
  "genre":        "독서(사회)",          // ★ "현대소설" 등 문학 라벨은 import 후
  "workTitle":    "지문 작품 / 주제",
  "examTitle":    "2025학년도 3월 고1 국어 모의고사 해설",
  "showSubtitle": false,
  "folder":       "기본",
  "blocks": [
    { "type": "cover", "data": { /* … */ } },
    { "type": "section_header", "data": { "tag": "PASSAGE", "title": "지문 상세 분석" } },
    /* …  */
    { "type": "section_header", "data": { "tag": "SOLUTION", "title": "문제 해설" } },
    { "type": "question", "data": { /* … */ } }
  ]
}
```

- `_id`/`id` 는 **있으면 update**, 없으면 insert.
- `passageId` 는 향후 `korean_passages` 컬렉션 도입 후 채운다. 1차에는 비워 둠.

## 2. 갈래별 권장 블록 순서

| 갈래 | 권장 조합 |
|---|---|
| **독서(인문·사회·예술·주제 복합)** | cover → section_header(PASSAGE) → info_box → paragraph_table → (compare_2col) → concept_grid → gist_box → section_header(SOLUTION) → question× |
| **독서(과학·기술)** | cover → section_header → info_box → paragraph_table → process_diagram → concept_grid → gist_box → section_header → question× |
| **문법** | cover → section_header(CONCEPTS) → concept_grid → question×5 (개념 먼저, 문제 연속) |
| **화법/작문** | cover → section_header → info_box → paragraph_table → (compare_2col) → gist_box → section_header → question× |
| 현대소설 (import 후) | cover → section_header → info_box → character_grid → timeline → compare_2col → gist_box → section_header → question× |
| 현대시 (import 후) | cover → section_header → info_box → paragraph_table(시상흐름) → emotion_flow → compare_2col → gist_box → section_header → question× |
| 고전시가 (import 후) | cover → section_header → info_box → sijo_box → paragraph_table → compare_2col → gist_box → section_header → question× |

## 3. 블록별 작성 가이드 (비문학 기준)

### `cover` — 표지
```jsonc
{
  "exam_title":  "2025학년도 3월 고1 국어 모의고사 해설",
  "set_range":   "22-25",
  "genre":       "독서(사회)",
  "work_title":  "디지털 격차와 사회 정책",
  "show_subtitle": false
}
```

### `section_header`
```jsonc
{ "tag": "PASSAGE", "title": "지문 상세 분석" }
```
`tag` 는 `PASSAGE` / `SOLUTION` / `CONCEPTS` 사이. 그 외에는 노란 chip 으로 강조됨.

### `info_box` — 기본 정보 표
```jsonc
{
  "heading": "지문 기본 정보",
  "rows": [
    { "label": "갈래", "value_html": "비문학 (사회)" },
    { "label": "주제", "value_html": "디지털 환경에서의 <span class='hl-key'>접근 격차</span> 해소 방안" },
    { "label": "구조", "value_html": "문제 제기 → 원인 분석 → 정책 제안 → 한계" }
  ]
}
```

### `paragraph_table` — 문단별 요약
```jsonc
{
  "columns": ["문단", "핵심 내용", "키워드"],
  "first_col_is_paranum": true,
  "rows": [
    { "cells": ["①", "정보 접근 격차의 정의·범위", "<span class='hl-term'>디지털 격차</span>"] },
    { "cells": ["②", "원인: 인프라·교육·소득", "구조적 요인"] }
  ]
}
```
- `cells.length` 가 `columns.length` 와 정확히 같아야 함 (validator 강제).

### `compare_2col` — 2단 대조
색 조합 매핑:
- `navy / red` → A vs B (대표 케이스)
- `navy / navy` → 둘 다 navy
- `green / red` → 협력 vs 갈등
- `green / navy` → 작품 A / B

```jsonc
{
  "left":  { "title": "기존 정책 (~2010)", "items_html": ["인프라 보급 중심", "도시·농촌 격차 부각"] },
  "right": { "title": "현 정책 (2010~)",   "items_html": ["역량·활용 중심", "<span class='hl-effect'>참여형 교육</span> 도입"] },
  "left_color":  "navy",
  "right_color": "red"
}
```

### `concept_grid` — 핵심 개념 카드
```jsonc
{
  "columns": 3,
  "cards": [
    { "name": "디지털 격차", "desc_html": "정보 접근·활용 능력의 사회적 불평등" },
    { "name": "역량 격차",   "desc_html": "디바이스 보급 이후 등장한 2차 격차" },
    { "name": "참여 격차",   "desc_html": "온라인 의사결정 참여 정도의 차이" }
  ]
}
```

### `process_diagram` — 과정 도해 (과학·절차)
```jsonc
{
  "title": "정책 결정 과정",
  "arrows": true,
  "nodes": [
    { "label": "문제 인식", "body_html": "현장 조사·통계 분석", "variant": "" },
    { "label": "대안 설계", "body_html": "예산·법령 검토",     "variant": "light" },
    { "label": "실행·평가", "body_html": "성과 지표 모니터링",  "variant": "dark" }
  ]
}
```
- `variant`: `""` 흰색 / `"light"` 노랑 / `"dark"` 초록.

### `gist_box` — 한 줄 요지
```jsonc
{
  "label": "한 줄 요지",
  "body_html": "디지털 격차 해소는 인프라 보급 만으로 부족하며, <strong>역량·참여를 보장하는 정책 전환</strong>이 필요하다."
}
```

### `question` — 문제 해설 (★ 모든 갈래 공통)
```jsonc
{
  "num": 22,
  "answer": "②",
  "points": 2,
  "intent": "지문의 중심 내용을 파악한다",
  "prompt_html": "윗글의 중심 내용으로 가장 적절한 것은?",
  "evidences": [
    { "label": "핵심 판단", "body_html": "②문단 말미에서 '역량 격차' 가 새로운 의제로 부상한다고 직접 서술." }
  ],
  "choices": [
    { "n": "①", "judge": "X", "text_html": "인프라 보급으로 격차가 해소됐다는 것은 사실과 다름" },
    { "n": "②", "judge": "O", "text_html": "역량·참여를 강조하는 정책 전환 — 지문 핵심" },
    { "n": "③", "judge": "X", "text_html": "지문은 시장 자율을 주장하지 않음" },
    { "n": "④", "judge": "X", "text_html": "교육 일변도가 아니라 종합 접근" },
    { "n": "⑤", "judge": "X", "text_html": "지문 범위 밖" }
  ],
  "correct_n": "②",
  "trap": {
    "title": "함정 포인트 — 부분 사실 ≠ 전체 주장",
    "body_html": "①처럼 일부 문단에서 다룬 내용을 글 전체 주제로 일반화하지 않도록 주의."
  }
}
```

**제약 (validator 강제):**
- `answer` 는 `①②③④⑤` 중 1자.
- `correct_n` 는 `choices[*].n` 안에 있어야 하며 `answer` 와 정확히 일치.
- `points === 3` 이면 출력에 자동으로 `[3점]` 뱃지 붙음 — 본문에 따로 쓸 필요 없음.
- 정답 행은 자동 노란 하이라이트.

## 4. 인라인 하이라이트

| 클래스 | 효과 | 용도 |
|---|---|---|
| `hl-key` | 노란 형광펜 + 굵게 | 핵심 키워드 |
| `hl-term` | 파란 박스 + navy 글자 | 용어 / 개념 |
| `hl-cause` | 빨강 굵게 | 원인 / 부정 |
| `hl-effect` | 초록 굵게 | 결과 / 긍정 |

다른 속성·클래스는 sanitize 단계에서 제거됨. `<strong>` `<em>` `<u>` `<br>` 만 통과.

## 5. 실행 흐름

```
# 1) 검증만 (저장 X)
npm run cc:korean-explain -- validate --json /Users/goshua/.../draft.json
npm run cc:korean-explain -- save --json /Users/goshua/.../draft.json --dry-run

# 2) 실제 insert
npm run cc:korean-explain -- save --json /Users/goshua/.../draft.json

# 3) update (응답에서 받은 id 를 JSON 최상단 "id" 키로 추가)
npm run cc:korean-explain -- save --json /Users/goshua/.../draft.json   # JSON 안에 "id": "<…>"

# 4) 채팅 출력을 그대로 파이프로
cat <<EOF | npm run cc:korean-explain -- save --json -
``` ` ``` json
{ ... }
``` ` ```
EOF
# (코드 펜스 자동 제거)
```

저장이 끝나면 `/admin/korean/explainer/list` 에서 즉시 보이고, `?id=<…>` 로 열어 편집·인쇄·PDF 출력.

## 6. 금지

- `/api/admin/korean-explainer/generate` 라우트 호출 / 신설 — Pro 정책 위반 (`CLAUDE.md` "Claude Code에서 API 사용 금지" 참고).
- 갈래별 if/else — 데이터 조합으로 흡수.
- `styles.css` 수정 — 보정은 `print-fix.css` 에만.
- 문학 4종 (`character_grid` / `timeline` / `emotion_flow` / `sijo_box`) 데이터를 채팅에서 즉석으로 채우는 작업 — 외부 정리물 import 파이프라인이 결정된 뒤 진행.
