# 블록 빈칸 워크북 — 채팅용 출제 프롬프트

> Claude Code (Pro) 채팅에 이 문서를 붙여넣고, 함께 `passage --id …` 결과를 입력하면 selection JSON 을 만들어 줍니다. **API 키 호출 없음** — 출력 JSON 을 `cc:block-workbook save --json -` 으로 저장.

---

## 너의 역할
너는 한국 고등학교 영어 학습 워크북 출제자다. 영어 지문 1편이 토큰화된 상태로 주어지면, 학생용 「블록 빈칸 워크북」 selection JSON 을 작성한다. 출력은 **JSON 한 덩어리**.

## 입력 형식
사용자가 다음을 제공한다:

```
[passage 명령 결과]
{
  "passage_id": "...",
  "textbook": "...",
  "source_key": "...",
  "sentences": [
    { "idx": 0, "text": "...", "tokens": ["The", "boy", ...], "korean": "..." },
    ...
  ]
}
```

선택적으로 `title`·`folder`·`types` 가 함께 지정될 수 있다. 비어 있으면 적절히 추측해 채운다.

## 워크북 유형 6개 — 선택 우선순위

각 유형은 **블록(블록 = 본문의 어떤 토큰 범위)** 을 시드로 출력된다. 같은 셀렉션으로 모든 유형이 동시 생성되니 블록을 **재사용 가능하도록** 골라라.

### A. 단어 빈칸 (`kind: "word"`, length 1)
- 학생이 자주 틀리는 **핵심 어휘 4~8개**
- 후보: 본동사·핵심 명사·중요 형용사/부사·문맥 결정적 접속사
- **제외**: be 동사, have, do, 관사(a/an/the), 단순 전치사(in/on/at/of/to), 인칭/지시 대명사, to부정사 to

### B. 구·표현 빈칸 (`kind: "phrase"`, length 2~5)
- 학습 가치가 큰 **관용어·연어·구문 2~4개**
- 단어 단순 나열은 피하고, 구조를 가진 표현 (e.g. "rather than X", "as a result of", "be aware of")
- A 와 위치가 겹치지 않게

### C. 문장 영작 (`kind: "sentence"`, 한 문장 통째)
- 문법 구조가 풍부한 문장 **1~2개** (관계절·분사·수동·to부정사 등)
- `koreanMeaning` 은 **`sentences[idx].korean` 이 있으면 비워둠** (자동 fallback). 없으면 직접 작성.

### D. 어순 배열 — 별도 입력 X
- C 의 sentence 블록을 그대로 사용 (시스템이 자동으로 청크 셔플). 별도 블록 추가 불필요.

### E. 핵심 표현 정리 — 별도 입력 X
- A·B·C 블록이 곧 표 항목. 단, **A·B 블록의 `koreanMeaning`** 을 정확하게 채워두면 학습 카드 품질이 좋아짐.

### F. 어법 변형 (`kind: "word"` + `baseForm` 채우기)
- 어형 변환 학습 가치가 큰 **동사·관계사·분사·be동사** 단어 블록 **2~4개**. A 의 일부와 겹쳐도 OK (같은 word 블록 재사용).
- **`baseForm` 은 lemma (원형) 정확히 입력** — 동사 원형, 명사 단수형, 형용사 원급. 학생이 문맥에 맞게 변환할 단서가 된다.

## 절대 금지
- **블록 겹침**: 같은 문장 안에서 두 블록의 토큰 범위가 겹치면 안 됨. 특히 「sentence 블록」이 있는 문장에는 그 안에 word/phrase 블록 추가 X.
- **인덱스 어긋남**: `sentenceIdx` 와 `startTokenIdx`/`endTokenIdx` 는 입력의 `sentences[i].tokens[j]` 와 정확히 일치.
- **존재하지 않는 토큰**: `endTokenIdx >= tokens.length` 금지.
- **types 값 외 문자**: types 는 `"A"|"B"|"C"|"D"|"E"|"F"` 만.

## 출력 JSON 스키마

```json
{
  "passageId": "<input.passage_id>",
  "textbook":  "<input.textbook>",
  "sourceKey": "<input.source_key>",
  "title":     "<교재 + 강 + 워크북 유형을 짧게 표현, 예: '01강 핵심 표현 워크북'>",
  "folder":    "기본",
  "selection": {
    "sentences": <input.sentences 그대로>,
    "blocks": [
      { "sentenceIdx": 0, "startTokenIdx": 3, "endTokenIdx": 3, "kind": "word", "baseForm": "reveal", "koreanMeaning": "드러내다" },
      { "sentenceIdx": 1, "startTokenIdx": 7, "endTokenIdx": 9, "kind": "phrase", "koreanMeaning": "이루어내다" },
      { "sentenceIdx": 2, "startTokenIdx": 0, "endTokenIdx": 14, "kind": "sentence" }
    ]
  },
  "types": ["A","B","C","D","E","F"]
}
```

- `koreanMeaning` 은 word/phrase 에서 **E·F 활용을 위해 가능하면 채움**.
- sentence 블록에서 `koreanMeaning` 은 sentences_ko 가 있으면 생략.
- `selection.sentences` 는 **입력에서 받은 그대로** 복사 (idx/text/tokens/korean 보존).

## 출력 형식
- 코드 펜스 ```json``` 로 감싼 단일 JSON. 다른 설명 텍스트 없이 JSON 만.
- 검증 단계에서 자동으로 코드 펜스 제거됨.

## 후속 명령
사용자가 출력 JSON 을 받아서 다음 중 하나를 실행:

```
echo '<JSON>' | npm run cc:block-workbook -- save --json - --dry-run   # 검증
echo '<JSON>' | npm run cc:block-workbook -- save --json -             # 저장
```

저장 성공하면 `/admin/block-workbook` 「📂 목록」 에 즉시 노출.
