# cc:grammar — 어법공략 워크북 자동 작성 워크플로우 (Pro 전용)

이 문서를 `@scripts/cc-grammar-prompt.md` 로 첨부해 Claude Code 채팅에서 호출하면, 한 지문의 **어법 포인트**를 먼저 추출하고 그것을 **F·G·H·J 4 모드** (양자택일 · 어법 오류 수정 · O·X 채점) 로 자동 변환·저장한다. **F (어형변환)** 는 별도 — baseForm 기반이라 포인트 풀과 무관.

**원칙**: API 키 호출 없음 — 모든 작업은 Claude Code(Pro 구독) 채팅에서 직접 JSON 을 작성하고 `cc:grammar` CLI 로 검증·저장만 수행. `/api/admin/grammar-workbook/save` 도 Anthropic API 호출 없음.

## 핵심 패러다임 — 포인트 풀 우선

기존 엑셀(`지금필수 고난도유형 - 3강_어법포인트_ai.xlsx`) 패턴을 따른다:

1. **한 지문 = 8 어법 포인트** 가 1차 데이터
2. 각 포인트 = `correctForm` + `wrongCandidates[]` + `grammarType` + `explanation` + `uses[]`
3. 포인트 풀에서 **F·G·H·J 4 모드를 파생** — 같은 데이터를 3 형태로 재사용

## 단축 사용

```
# 교재 한 권 부족 지문 확인
npm run cc:grammar -- shortage --textbook "26년 3월 고1 영어모의고사"

# 한 지문 끝까지 자동 작성·저장 (Claude Code 채팅에 paste — 반드시 단일 라인)
@scripts/cc-grammar-prompt.md 워크플로우대로 passageId=<ID> textbook="<교재>" source_key="<sk>" folder="기본" 에 어법 포인트를 문장당 2~3개 추출하고 동기화(문장당 1개씩 F·G·H·J 분배) → dry-run → save 까지 자동 진행.
```

## 단계별 절차

### 1. 부족 지문 확인

```
npm run cc:grammar -- shortage --textbook "교재명" [--modes FGHJ|FG] [--folder "기본"]
```

응답의 `shortage[]` 배열에 처리 대상 지문이 나온다. 각 항목:
- `passage_id` — 다음 단계 `passage --id` 인자
- `source_key` — 시험지 헤더용
- `have_modes` — 이미 채워진 모드
- `need_modes` — 채워야 할 모드

### 2. 지문·문장표 받기

```
npm run cc:grammar -- passage --id <passage_id>
```

응답의 `sentences[]` 배열을 그대로 ExamData JSON 의 `sentences` 필드로 복사. 각 sentence: `idx`, `text`, `tokens`, `korean` (있으면).

### 3. ✨ 어법 포인트 추출 (1차 작업)

지문에서 **어법 포인트**를 골라 다음 스키마로 작성. 규칙:
- ⭐ **한 문장당 2~3개** 포인트 (같은 sentenceIdx 에 여러 포인트 OK). 9 문장이면 18~27 포인트가 목표.
  - 어법 요소가 **도저히 없는 문장**만 예외로 줄이되, 모든 문장에서 **최소 1개**는 잡을 것.
  - 같은 문장 안의 2~3개는 **서로 다른 위치/유형**으로 (예: 한 문장에서 수일치 + 관계사 + 시제).
- **왜 문장당 여러 개인가**: 동기화 시 F·G·H·J 4개 유형에 **문장당 1개씩 서로 다른 포인트**로 자동 분배된다. 그래야 각 유형이 **다른 문항**이 되어 학생이 한 지문으로 더 많이 학습한다. 문장당 포인트가 1개뿐이면 모든 유형이 같은 문항이 된다.
- **8가지 문법 유형**을 골고루 분포시킬 것.

```typescript
interface GrammarPoint {
  id: string;                          // 클라이언트 고유 ID — "S<sentence>-T<start>-<random>" 형태
  sentenceIdx: number;                 // sentences[i].idx
  startTokenIdx: number;               // 시작 토큰
  endTokenIdx: number;                 // 끝 토큰 (단일이면 == startTokenIdx)
  correctForm: string;                 // 원문 표현 (토큰 join)
  wrongCandidates: string[];           // 함정 1~3개. 첫 번째가 모드 변환 시 기본 wrong 으로 쓰임
  grammarType: string;                 // '수일치'|'전치사'|'시제'|'수동태'|'관계사'|'접속사'|'분사'|'부정사' 또는 기타 자유
  explanation: string;                 // 왜 정답이고 함정이 왜 틀린지 — 학생 학습용
  koCorrect?: string;                  // 정답(correctForm)에 대응하는 한국어 표현. 분석지 해석에서 그 부분만 색칠됨. 예: 'express'→'표현한다', 'who'→'(누구인지/사람을 가리키는 부분)'. 해석 문장에 그대로 들어 있는 표현으로.
  confidenceScore?: number;            // (AI 추출이 아니면 비워둠)
  uses: ('F' | 'G' | 'H' | 'J')[];     // 어느 모드에 사용할지. 동사·어형 포인트(단일토큰)는 'F' 포함, 기능어는 ['G','H','J']
  baseForm?: string;                   // F 적격일 때 원형(lemma). uses 에 'F' 있으면 필수
  hRole?: 'error' | 'decoy';           // H 모드 역할. 'error'=치환·정답에 노출, 'decoy'=번호만. 기본 'error'
  jVariant?: 'wrong' | 'correct';      // J 모드 변형. 'wrong'=X 보기(오답형), 'correct'=O 보기(원문). 기본 'wrong'
}
```

#### 8 가지 문법 유형 (엑셀 기준 분포)

| 유형 | 예 |
|---|---|
| 수일치 | data are vs. data is, 복수 주어 + 복수 동사, **each/every + 단수동사**, 삽입어구 뒤 수일치 (each musician … claims) |
| 전치사 | by + -ing, due to, because of |
| 시제 | has + p.p., is + -ing |
| 수동태 | be + p.p., is being + p.p. |
| 관계사 | who/which/that, 선행사 일치, **관계대명사 what vs 동격 that** |
| 접속사 | because vs. due to, while vs. during, **동격 that vs what** (명사 + that + 완전한 절), **상관접속사** (either A or B / neither A nor B / both A and B / not only A but also B) |
| 분사 | 현재분사 vs. 과거분사, **분사구문 능동(-ing)/수동(p.p.)** (forcing vs forced) |
| 부정사 | to + V, V + to + V, **사역·지각동사 + 원형부정사** (let/make/have + V원형, to V 오답) |

분포 예 (문장당 2~3개): 8 유형을 전체 포인트에 골고루 섞는다(유형 반복 허용). 핵심은 **모든 문장에서 2~3개씩 뽑아** F·G·H·J 분배 시 유형마다 다른 문항이 되게 하는 것.

#### ⭐⭐ 고빈도 출제 함정 — 문장마다 반드시 스캔 (출제자 관점)

실제 시험에서 자주 나오는 함정이다. **각 문장을 읽을 때 아래 체크리스트를 훑어** 해당되면 우선 포인트로 잡아라. 짧은 문장(`Let there be no doubt` 등)도 예외 없이 점검.

1. **사역·지각동사 + 원형부정사**: `let/make/have + 목적어 + V(원형)`, `see/watch/hear/feel + 목적어 + V/V-ing`. → 목적격보어 자리에 **to부정사(to be) 오답**. 예) *Let there **be** no doubt* (정답 be / 함정 to be).
2. **동격 that vs 관계대명사 what·which**: `명사(idea·fact·news·belief·idea that…) + that + 완전한 절`. 앞 명사와 내용이 같으면 **동격 접속사 that**, 불완전절이면 관계대명사. → *the idea **that** a musical act is a thing* (정답 that / 함정 what·which, 뒤 절이 완전하므로).
3. **분사구문 능동/수동**: 삽입·문두 분사구. 주어와 **능동이면 현재분사(-ing), 수동이면 과거분사(p.p.)**. → *each musician, **forcing** predecessors…, claims…* (정답 forcing / 함정 forced — musician 이 force 하는 능동).
4. **삽입어구 뒤 수일치**: 주어와 동사 사이에 분사구·전치사구·관계절이 끼어 헷갈리게 함. `each/every/one of + 단수동사`. → *each musician, (forcing …), **claims***  (정답 claims 단수 / 함정 claim — 주어 each musician 단수).
5. **재귀대명사 (강조·재귀)**: 주어·목적어를 강조하거나(the animal **itself**) 주어=목적어일 때 재귀대명사. → 인칭대명사(it/them) **오답**. (grammarType: `'대명사'`)
6. **2형식 동사 + 형용사 보어**: `seem/become/look/feel/remain/stay/grow/turn/keep + 형용사`. 보어 자리엔 부사 불가. → *that seems **unlikely*** (형용사 / 함정 부사 unlikelily). (grammarType: `'형용사'` 또는 `'보어'`)
7. **상관접속사 (짝 표현)**: `either A or B` / `neither A nor B` / `both A and B` / `not only A but also B`. 짝이 틀리거나(either…nor 오답) A·B 가 **병렬(같은 품사·형태)** 이 아니면 오답. 예) *either individually **or** as organized…* (or 의 짝 + 앞뒤 병렬). (grammarType: `'접속사'`)
8. **관계대명사 vs 관계부사 / what vs that**: 뒤 절의 완전·불완전 여부, 선행사 유무로 결정.
9. **병렬구조**: `A, B, and C` 가 같은 품사·형태인지.
10. (그 외) 가정법·도치·대동사·비교급·it 가주어/진주어 등 보이면 잡는다.

> 위 1~7 은 학생 오답률이 높아 출제 1순위. 한 지문에서 이런 함정이 보이면 **무조건 포인트로 포함**시켜, 단순 수일치/전치사만 반복하지 말 것. grammarType 은 8 유형 외 `'대명사'`·`'형용사'` 등 자유롭게 써도 된다.

#### ⭐ 동기화 = 문장당 1개씩 분배 (워크북 생성 규칙)

`modeData.P.points` 에 문장당 2~3개를 넣으면, 동기화가 **문장마다 F·G·H·J 에 서로 다른 포인트를 1개씩** 배정한다(제약이 큰 F 부터, 포인트가 모드 수보다 적으면 일부 공유). 따라서:
- 같은 문장에 **유형/위치가 다른** 포인트를 넣을수록 4개 유형이 더 다양한 문항이 된다.
- F 적격(단일토큰·동사/어형·baseForm) 포인트를 문장마다 1개씩 섞어 두면 F 가 골고루 채워진다.

### 4. F (어형변환) — 포인트에서 자동 동기화

**규칙: F 를 최대화하라.** F 는 「원형(baseForm) → 문맥 어형」 변환이 **의미 있는 단일 토큰 포인트**에 모두 적용한다. 즉 아래 조건을 만족하면 **반드시** `uses` 에 `'F'` 를 넣고 `baseForm`(원형)을 채운다.

F 적격 (단일 토큰 + 원형 존재):
- **동사 어형** — 시제(generates→generate) / 수동태(intended→intend) / 분사(self-organizing→self-organize) / 수일치(happens→happen) / 조동사 뒤 동사원형 등
- **명사 수**(boxes→box), **형용사·부사 파생**(quickly→quick) 등 lemma 가 분명한 경우

F 부적격 (F 에 넣지 말 것 — `uses` 에서 'F' 제외):
- **원형이 없는 기능어** — 관계사(who/which), 접속사(as/because), 전치사(along/during), 대명사
- **멀티 토큰** 포인트(`endTokenIdx > startTokenIdx`, 예: "to satisfy")

목표: 8 포인트 중 동사류·어형 포인트는 가급적 모두 F 포함 → F 가 보통 **4~6개** 나오도록. (수일치 포인트도 동사면 `happen` 같은 baseForm 을 꼭 채워 F 에 넣는다.)

```json
{
  "id": "S0-T3-001",
  "sentenceIdx": 0, "startTokenIdx": 3, "endTokenIdx": 3,
  "correctForm": "revealed", "wrongCandidates": ["reveals"],
  "grammarType": "시제",
  "explanation": "과거 시제 — 본문 흐름이 과거.",
  "uses": ["F", "G", "H", "J"],
  "baseForm": "reveal",
  "hRole": "error", "jVariant": "wrong"
}
```

관계사·전치사처럼 F 부적격이면 `uses: ["G","H","J"]` (F 없음), `baseForm` 생략.

### 5. JSON 작성 (포인트 풀 + F + 메타)

`.grammar-drafts/<sourceKey_slug>.json` 에 저장. 핵심은 **`modeData.P.points`** 안에 포인트 풀을 넣는 것. G·H·J 는 dry-run 직전에 server-side sync 가 자동 생성하지만, **검증을 위해 client-side 에서도 미리 동기화** 해서 G·H·J 도 채워 두는 것을 권장.

```json
{
  "passageId": "<passage_id>",
  "textbook": "<교재>",
  "sourceKey": "<source_key>",
  "title": "<교재> <번호> 어법공략",
  "folder": "기본",
  "examMeta": {
    "examTitle": "영어 어법공략 평가",
    "schoolName": "○○고등학교",
    "grade": "2학년",
    "questionNumber": "어법공략"
  },
  "sentences": [ /* passage 명령 응답 그대로 */ ],
  "modes": ["F", "G", "H", "J"],
  "modeData": {
    "F": { "blocks": [ /* word 블록 3~5 + baseForm */ ] },
    "P": {
      "points": [
        {
          "id": "S0-T2-001",
          "sentenceIdx": 0, "startTokenIdx": 2, "endTokenIdx": 2,
          "correctForm": "are", "wrongCandidates": ["is"],
          "grammarType": "수일치",
          "explanation": "주어 data 는 datum 의 복수형 — 복수 주어이므로 be 동사 are.",
          "uses": ["G", "H", "J"], "hRole": "error", "jVariant": "wrong"
        }
        /* ... 7 more points */
      ]
    },
    "G": { "points": [ /* P 에서 파생 — pointsToEitherOr */ ] },
    "H": { "spans": [ /* P 에서 파생 — pointsToCorrection */ ] },
    "J": { "items": [ /* P 에서 파생 — pointsToOx */ ] }
  }
}
```

#### 포인트 → G·H·J 파생 규칙

- **G (양자택일)**: `uses.includes('G')` 인 포인트 → `{sentenceIdx, startTokenIdx, endTokenIdx, correctForm, wrongForm: wrongCandidates[0], explanation}`
- **H (오류수정)**: `uses.includes('H')` 인 포인트 →
  - `hRole='error'`: `{...locus, isError: true, wrongForm: wrongCandidates[0], correction: correctForm, explanation}`
  - `hRole='decoy'`: `{...locus, isError: false}` (번호만)
- **J (O·X)**: `uses.includes('J')` 인 포인트 →
  - `jVariant='wrong'`: 본문 토큰 일부를 wrongCandidates[0] 로 치환한 문장. `isCorrect: false`, `correction: <원문>`, `explanation`
  - `jVariant='correct'`: 원문 문장 그대로. `isCorrect: true`, `explanation`

### 6. 검증

```
npm run cc:grammar -- save --json .grammar-drafts/<slug>.json --dry-run
```

`ok: true, warnings 무관` 이면 통과. 흔한 errors:
- `sentenceIdx 가 sentences 에 없음` → passage 응답에서 다시 확인
- `startTokenIdx / endTokenIdx 토큰 범위 밖` → 인덱스 수정

### 7. 저장 (실제 insert/upsert)

```
npm run cc:grammar -- save --json .grammar-drafts/<slug>.json
```

응답 `id`, `created/updated` 확인.

### 8. 배치 — save-all

```
npm run cc:grammar -- save-all .grammar-drafts/*.json
```

## ⚠ 절대 dry-run 에서 멈추지 마

자주 발생하는 실수:
- ❌ "save 단계가 요청에 명시되지 않아 실행 안 함" — 한 줄 호출에 `save 까지` / `자동 진행` 가 있으면 step 7 은 의무.
- ❌ "worktree 안에 있어서 isolation 차원에서 save 안 함" — **worktree 격리는 파일시스템에만 적용**. `cc:grammar save` 는 MongoDB(원격) 에 insert/upsert 하므로 worktree 와 무관하게 실제 DB 에 들어간다.
- ❌ "draft 만 만들고 사용자가 검토 후 직접 save 하길 기대" — Pro 자동화의 목적은 hands-off. dry-run 통과 후 즉시 save.

dry-run 이 `ok: true` 면 그 자리에서 같은 JSON 을 `--dry-run` 빼고 다시 save 하는 것이 디폴트 동작이다.

## 한 줄 자동화 (Claude Code 채팅용)

⚠ **반드시 단일 라인(줄바꿈 없음)** 으로 전달할 것 — 멀티라인 paste 는 터미널 escape 으로 잘림.

### 패턴 A — 부족 지문 1 건 자동 채움

```
@scripts/cc-grammar-prompt.md 워크플로우대로 교재 "<교재명>" 의 shortage[] 배열 첫 지문에 어법 포인트를 문장당 2~3개 추출 → F·G·H·J 동기화(문장당 1개씩 분배) → dry-run → save 까지 자동 진행해줘.
```

### 패턴 B — 특정 지문 (UI 「🚀 전체작업」 버튼이 사용)

```
@scripts/cc-grammar-prompt.md 워크플로우대로 passageId=<ID> textbook="<tb>" source_key="<sk>" folder="기본" 에 어법 포인트를 문장당 2~3개(8 유형 골고루) 추출 → F·G·H·J 동기화(문장당 1개씩 서로 다른 포인트 분배) → dry-run → save 까지. 모든 정답에 explanation 필수. --force 금지.
```

## 금지

- `/api/admin/essay-generator/generate` 같은 Anthropic API 라우트 호출 X
- `--force` 무분별 사용 X (errors 가 있으면 원인 고치기)
- 같은 `sentenceIdx` 안에서 포인트 인덱스가 겹치는 데이터 작성 X
- 단일 라인 호출인데 도중에 사용자 확인 요청 X (hands-off 자동화)
