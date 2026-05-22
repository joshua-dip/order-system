# 지문분석기 Pro 워크플로우 (cc:syntax)

> Claude Code (Pro) 채팅에 이 문서를 첨부하고 **passageId** 만 전달하면 그 지문의 **모든 분석 항목**을 채워 저장한다. **API 키 호출 없음** — `passage`/`save`/`save-all` 만 사용.

---

## 1. 입력 / 출력

**입력**: passageId (24-char hex ObjectId).
**출력**: MongoDB `gomijoshua.passage_analyses` 의 `passageStates.main` 한 건 갱신.

저장 파일 위치 권장: `.syntax-drafts/<passageId>.json`.

---

## 2. 실행 흐름 (반드시 이 순서)

### 2-1. 지문·문장표 가져오기

```
npm run cc:syntax -- passage --id <passageId>
```

응답에서 `sentences` (idx·en·ko) 를 보존. **분석 인덱스의 모든 기준**(svocData·syntaxPhrases·grammarTags 의 sentenceIndex / startIndex 등) 은 이 배열의 idx 와 1:1 매칭.

### 2-2. 분석 JSON 작성

`.syntax-drafts/<passageId>.json` 에 다음 구조로 저장:

```json
{
  "passageId": "<passageId>",
  "main": {
    "sentences":         [...],            // 1단계 출력 그대로 복사 (idx 순)
    "koreanSentences":   [...],            // 1단계 출력 그대로 복사 (idx 순)
    "analysisResults":   { "comprehensive": { "1": "주제 …", "2": "요지 …", "3": "요약 …", "4": "해석 …", "5": "함의 …" } },
    "topicHighlightedSentences":  [0],
    "essayHighlightedSentences":  [2, 5],
    "grammarSelectedWords":       ["pivotal", "anchored", "constituted"],
    "contextSelectedWords":       ["nevertheless", "by contrast"],
    "sentenceBreaks":             { "0": [5, 12], "1": [8] },
    "svocData":                   { "0": { ... }, "1": { ... } },
    "syntaxPhrases":              { "0": [ ... ], "1": [ ... ] },
    "grammarTags":                [ { "sentenceIndex": 0, "tagName": "관계대명사", ... } ],
    "grammarPointsBySentence":    { "0": [ { "title": "분사구문", "content": "…" } ] },
    "vocabularyList":             [ { "word": "pivotal", "meaning": "결정적인", "partOfSpeech": "adj.", "cefr": "C1", "positions": [{ "sentence": 0, "position": 6 }] } ]
  }
}
```

### 2-3. dry-run 검증

```
npm run cc:syntax -- save --json .syntax-drafts/<passageId>.json --dry-run
```

`validation.ok === true` 인지 확인. errors 가 있으면 **반드시** 수정 후 재시도. **`--force` 같은 우회 옵션 없음 — 검증 실패 시 멈출 것.**

### 2-4. 저장

```
npm run cc:syntax -- save --json .syntax-drafts/<passageId>.json
```

응답의 `progress.percent` 가 100 이면 모든 분석 카테고리 채움 완료.

---

## 3. 분석 항목별 작성 규칙

각 항목은 **선택** 이지만, 이 워크플로우의 목표는 **모두 채움 (progress 100%)**.

### 3.1 `sentences` / `koreanSentences` (필수)

1단계 출력의 `sentences[].en` 과 `.ko` 를 배열 순서 그대로 보존. 길이 동일.

### 3.2 `analysisResults.comprehensive` (종합분석)

`{ "1": "주제", "2": "요지", "3": "요약", "4": "해석", "5": "함의" }` 5 슬롯 모두 채움. 한국어로 1~3 문장씩. **본문을 그대로 베끼지 말고 의미 단위로 재구성**.

슬롯 추가가 필요하면 `comprehensiveSlotCount: 6` 등으로 늘리고 `"6": "…"` 추가.

### 3.3 `topicHighlightedSentences` (주제문장)

본문의 핵심 주장이 담긴 문장 인덱스 배열. 보통 1~2 개. 없으면 `[]`.

### 3.4 `essayHighlightedSentences` (서술형대비)

서술형 출제 (변형/요약/영작) 에 적합한 문장 인덱스. 보통 2~4 개. 문법 구조가 풍부한 문장 우선.

### 3.5 `grammarSelectedWords` (어법)

본문에서 어법 학습용으로 다룰 만한 단어/구. 동사 활용 / 시제 / 수일치 / 분사 / 관계대명사 / 가정법 등 어법 포인트 표면 단어. 보통 5~12 개.

### 3.6 `contextSelectedWords` (문맥)

지시어·연결어·대조어 등 문맥 추론용. 본문 의미 흐름을 결정하는 keywords. 보통 5~10 개.

### 3.7 `sentenceBreaks` (끊어읽기)

`{ sentenceIndex: number[] }` — 각 문장 안 슬래시 삽입 위치 (단어 인덱스). 예: `"0": [3, 9, 14]` 는 0 번 문장의 3·9·14 단어 뒤에 슬래시. 의미·구·절 단위로. 모든 문장에 대해 작성 권장.

### 3.8 `svocData` (S/V/O/C)

각 문장의 주어·동사·(목적어)·(보어) 의 **문자 인덱스 범위** (character offset, sentence 문자열 안).

```json
"0": {
  "subject":        "The first item",
  "subjectStart":   0,
  "subjectEnd":     14,
  "verb":           "is",
  "verbStart":      15,
  "verbEnd":        17,
  "subjectComplement": "pivotal",
  "subjectComplementStart": 18,
  "subjectComplementEnd":   25
}
```

- 5 형식: S, S-V, S-V-O, S-V-O-C, S-V-Oi-Od 중 해당하는 필드만.
- start/end 는 sentence 문자열의 `slice(start, end)` 가 해당 구문과 일치하도록.
- 모든 문장 채움 권장.

### 3.9 `syntaxPhrases` (구문)

`{ sentenceIndex: SyntaxPhrase[] }`. 각 SyntaxPhrase 는 **단어 인덱스 범위** (공백 split 기준):

```json
{
  "text":       "that he could not refuse",
  "label":      "관계절",
  "type":       "clause",
  "startIndex": 5,
  "endIndex":   9,
  "color":      "#22c55e",
  "depth":      1,
  "modifies":   "offer"
}
```

- `type`: `'clause'` (S+V 포함) | `'phrase'` (구).
- `depth`: 0 부터 시작. 중첩이 있으면 1, 2, 3 ….
- `color`: hex (예: 분사구문 `#a855f7`, 관계절 `#22c55e`, 부사절 `#f59e0b`, 명사절 `#3b82f6`, to부정사 `#ef4444`, 동명사 `#06b6d4`).
- `modifies`: 해당 구문이 수식하는 어구 (선택).

### 3.10 `grammarTags` (문법태그)

문법 현상을 단어 범위 단위로 태깅:

```json
{
  "sentenceIndex":   0,
  "tagName":         "현재완료",
  "selectedText":    "has been considered",
  "startWordIndex":  3,
  "endWordIndex":    5,
  "category":        "시제",
  "explanation":     "주어와 동사 사이 5단어 수식어로 수일치 함정"
}
```

- 한 지문당 8~20 개 권장.
- `category` 권장 값: 시제 / 태 / 가정법 / 분사 / 관계사 / 접속사 / 부정사·동명사 / 비교 / 도치·강조 / 대명사 / 어휘 / 수일치.

### 3.11 `grammarPointsBySentence` (문법 포인트)

문장별 lesson-card 짝. `{ title, content }` 의 짧은 메모:

```json
"0": [
  { "title": "수동태 + by", "content": "is considered by … 형태로 행위주체 명시" },
  { "title": "관계대명사 that", "content": "선행사 the work 를 한정" }
]
```

서술형 출제기의 grammar_points 와 동일 모양.

### 3.12 `vocabularyList` (단어장)

본문 핵심 어휘:

```json
{
  "word":          "pivotal",
  "meaning":       "결정적인, 중심이 되는",
  "wordType":      "word",
  "partOfSpeech":  "adj.",
  "cefr":          "C1",
  "synonym":       "crucial, central",
  "antonym":       "marginal",
  "positions":     [{ "sentence": 0, "position": 6 }]
}
```

- `partOfSpeech`: `n.` / `v.` / `adj.` / `adv.` / `prep.` / `conj.` / `pron.` / `art.` / `n. phrase` / `v. phrase`.
- `cefr`: A1 ~ C2 (대략 학교 학년: A2≈중1, B1≈중3, B2≈고1, C1≈고2~3, C2 대학+).
- `positions`: 본문 안 등장 위치 (문장 idx + 단어 idx 0-base).
- 한 지문당 15~30 개 권장. 본문 외 단어 X.

---

## 4. 검증 체크리스트

`save --dry-run` 호출 직전 자체 점검:

- [ ] `sentences.length === koreanSentences.length`
- [ ] 모든 `sentenceIndex` 가 0 ~ `sentences.length - 1` 안
- [ ] `svocData` 의 모든 start/end 가 해당 sentence 문자열 길이 안
- [ ] `syntaxPhrases` 의 startIndex/endIndex 가 해당 sentence 의 단어 수 안 (공백 split)
- [ ] `grammarTags` 의 startWordIndex ≤ endWordIndex
- [ ] `vocabularyList.positions.sentence` 가 인덱스 범위 안
- [ ] `analysisResults.comprehensive` 의 5 슬롯 모두 비어있지 않음

---

## 5. 금지 사항

- `passage-analyzer-cli.ts run-ai` (ANTHROPIC API 키) 호출 **금지**.
- `/api/admin/passage-analyzer/comprehensive-analysis` 등 AI 라우트 직접 호출 **금지**.
- 검증 실패 시 `--force` 같은 우회 **금지** (현재 옵션 없음. 추가 요청 시에도 거부).
- 본문에 없는 단어를 `vocabularyList` 에 넣지 말 것.
- 영어 문장을 임의로 수정하지 말 것 (`sentences` 는 1 단계 출력 그대로).
