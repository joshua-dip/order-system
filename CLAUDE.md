# next-order — Claude Code 힌트

## Pro 플랜만 쓰고 API 과금은 피하려면

- **Claude Pro / Max** = Claude **Code·채팅** 안에서 쓰는 모델 사용량 (여기서 문제 지문 읽고 JSON 직접 작성).
- **`ANTHROPIC_API_KEY`** = [콘솔](https://console.anthropic.com) **API 별도 과금** — Pro 구독과 **합산되지 않음**.

**Pro만으로 가능한 경로**

- 채팅에서 지문·부족 분 확인 → **문제 본문은 네가 작성** → 저장만 MCP/CLI:
  - MCP: `variant_list_*`, `variant_get_passage`, `variant_get_shortage`, `variant_save_generated_question`, 검수 `variant_review_pending_*`
  - CLI: `npm run cc:variant` (조회·저장·부족 분). `save` 는 채팅에서 만든 `question_data` JSON 파일로.
- **쓰지 않기:** MCP `variant_generate_draft` / `variant_generate_and_save`, 관리자 웹 **「Claude로 초안 생성」**, `POST /api/cron/variant-auto-fill`, `npm run variant:auto-fill` (전부 API 키).

**도구 승인 창이 뜰 때:** `variant_generate_draft` 또는 `variant_generate_and_save`면 **Pro만 쓰려면 3. No** — 같은 일은 `variant_get_passage`로 지문만 받은 뒤 **채팅에서** `question_data` JSON을 작성하고 **`variant_save_generated_question`** 만 허용한다.

배포 서버에 **API 키를 넣지 않으면** 위 API 경로는 동작하지 않아, 실수로 API 과금이 나가기 어렵다.

---

## 보안 · BV 주문번호 · MongoDB

- **`MONGODB_URI`는 출력 금지** — `console.log(uri)`, 터미널에 연결 문자열 찍기, 채팅에 붙여넣기 하지 말 것. (한 번이라도 터미널에 나왔다면 **Atlas에서 DB 사용자 비밀번호 즉시 교체** 권장.)
- **BV·MV·주문 기준 부족 분:** **`variant_get_shortage`에 `orderNumber`만 전달** (부교재 변형 BV, 모의고사 변형 MV 모두 `orderMeta.flow`에 따라 집계). MCP 없이면 `npm run cc:variant -- shortage --order-number MV-…` / `BV-…`. **더 짧게:** `npm run claude -- claude:MV-20260401-003` 등 주문번호만 써도 `shortage`와 동일 JSON.
- **주문 한 줄 파이프라인:** 채팅에 **`BV-20260529-002`** 또는 `MV-…` 만 입력하면 **부족 파악 + 대기 자동 검수 + 신규 생성 가이드**까지 한 번에 처리. 터미널 등가: `npm run cc:variant -- pipeline:BV-…` (또는 단축: `npm run cc:variant -- BV-…`). 자동 검수 단계는 `recordReviewLogFromClaudeCode` 가 DB 정답 + per-question 종합 검증을 동시에 돌려, 검증 error 가 있으면 정답이라도 `검수불일치 (forced)` 로 보냄. 신규 작성이 필요하면 `scripts/cc-order-pipeline-prompt.md` 의 흐름대로 채팅에서 직접 작성 → `variant_save_generated_question` → 마지막에 `pipeline:` 재실행으로 마무리.
- **금지:** 주문/orderId 찾기용으로 `node -e` + `MongoClient` + 컬렉션 나열·임의 쿼리를 돌리는 것. (DB명·컬렉션은 앱 코드 `getDb('gomijoshua')`, `orders` 참고 — 에이전트가 직접 몽고 셸을 열지 말 것.)

---

MCP 서버 **next-order-variant** 가 등록되어 있을 때, 아래처럼 **짧게 말해도** 해당 도구를 쓰면 된다.

| 내가 이렇게 말하면 | 할 일 (MCP) |
|-------------------|-------------|
| 대기 목록 / 대기 문항 / pending | `variant_review_pending_list` (기본 limit 10, 많이 보려면 limit 30) |
| 대기 풀고 로그 | 풀이 후 `variant_review_pending_record` — 서버가 DB 정답과 비교해 `is_correct` 계산. **일치하고 문항이 대기였으면** 기본은 **완료** (`status_updated_to_complete: true`). **`attemptNumber` ≥ 2**이면 재시도 검수로 보아 **검수불일치** (`status_updated_to_mismatch: true`) |
| 교재 목록 | `variant_list_textbooks` |
| 지문 목록 | `variant_list_passages` + textbook |
| 지문 원문 | `variant_get_passage` + passage_id |
| 부족·워크로드 | `variant_get_shortage` — 응답 **`pendingReviewTotal`**: 검수 대기(대기) 건수 → **`variant_review_pending_list`** 로 풀고 **`variant_review_pending_record`** (정답 일치 시 완료). **`needCreateGrandTotal`**: 아직 없어서 **새로 만들어야** 하는 문항 수 추정(`needCreateShortBySum` + 무지문 지문 슬롯). textbook / **orderNumber(BV-)** / orderId · **부족이 있으면 「만들까요」로 묻지 말고** 바로 `variant_get_passage` → 작성 → `variant_save_generated_question` (또는 정책대로)까지 연쇄 진행 |
| 주문 한 줄 (`BV-…`/`MV-…`) | **터미널**: `npm run cc:variant -- pipeline:BV-…` (또는 단축 `npm run cc:variant -- BV-…`) — shortage + 대기 자동 검수(per-question 검증 동반) + 신규 생성 가이드 JSON. **채팅**: 사용자가 주문번호만 입력하면 `scripts/cc-order-pipeline-prompt.md` 흐름대로 자동 진행 (필요하면 `variant_get_passage` → JSON 작성 → `variant_save_generated_question` 까지). 「만들까요」 등 되묻기 금지. |
| 문제 저장 | `variant_save_generated_question` (또는 CLI: `npm run cc:variant -- save --json …`) |
| 주제·빈칸 등 **새 문항 만들기 (Pro만)** | `variant_get_passage` → **채팅에서** JSON 작성 → `variant_save_generated_question` (**`variant_generate_draft` 금지**) |

**터미널만 (MCP 없이):** `npm run cc:variant -- --help` · **주문 한 방 (shortage만)**: `npm run claude -- claude:BV-20260331-002` · **주문 한 줄 파이프라인 (검수까지)**: `npm run cc:variant -- pipeline:BV-20260529-002` 또는 단축 `npm run cc:variant -- BV-…` · 프로젝트 루트에서 실행 권한이 있으면 `./claude claude:BV-…` 도 동일하게 동작 (`claude` 스크립트가 `tsx`로 CLI를 호출).

---

## 서술형 변형문제 (Pro 전용 — `cc:narrative`)

`/admin/generated-questions?mode=essay` (= **`narrative_questions`** 컬렉션) 의 서술형 변형을 **객관식 변형(cc:variant)과 똑같이** Pro 전용으로 생성. **API 키 호출 없음** — 채팅에서 `question_data` 작성 → CLI 가 검증·insert. (cc:essay 의 `essay_exams`/`/admin/essay-generator` 와는 **별개 컬렉션·별개 제품**.)

```
npm run cc:narrative -- textbooks
npm run cc:narrative -- passages --textbook "교재명"            # 지문별 subtype 보유 수
npm run cc:narrative -- passage  --id <passageId>              # 원문 + 기존 서술형 + 지원 subtype
npm run cc:narrative -- shortage --textbook "교재명" [--required 1] [--subtype "..."]
npm run cc:narrative -- save --json draft.json [--dry-run]     # 검증 후 narrative_questions insert
단축: npm run cc:narrative -- "교재명"   → shortage
```

- 지원 subtype 3종: **이중요지영작형**, **빈칸재배열형(A+B·주제·Hard)**, **빈칸재배열형(A+B·어법·Hard)**.
- 작성 규칙: `scripts/cc-narrative-prompt.md` (빈칸재배열형은 `키워드`↔`모범답안` 단어 멀티셋 일치 강제, 이중요지영작형은 `<u>과제</u>` 2개 + 답안 단어수 범위).
- 저장분은 `source_file='claude-code'`·`excel_row_status='claude-authored'` 마커로 엑셀 임포트 curated 분과 구분.
- mode=essay 관리 화면은 **narrative 단일 소스로 고정**(병합 제거)·상세 읽기 전용.
- **금지:** `/api/variant/essay-generate`, `/api/my/member-variant/essay-generate` (Anthropic API). CLI `save` 만 사용.

---

## 서술형 출제기 (Pro 전용 — `cc:essay`)

`/admin/essay-generator` 와 동일한 HTML 을 만드는 CLI. **API 키 호출 없음** (채팅에서 ExamData JSON 작성 → CLI 가 검증·렌더·저장만 담당).

```
npm run cc:essay -- textbooks                                    # 교재 목록
npm run cc:essay -- passages --textbook "26년 3월 고1 영어모의고사"
npm run cc:essay -- passage  --id <passageId>                    # 지문+문장표+서술형대비 인덱스
npm run cc:essay -- shortage --textbook "..." [--required 1] [--difficulty 고난도|중난도|기본난도|all] [--folder "..."|all]
npm run cc:essay -- save --json draft.json [--dry-run] [--force] # 검증·HTML 생성 후 essay_exams 에 insert
cat draft.json | npm run cc:essay -- save --json -               # stdin (코드펜스 ```json 자동 제거)
단축: npm run cc:essay -- "26년 3월 고1 영어모의고사"            # shortage 와 동일
```

**작성 흐름 (Claude Code 자동화)**
1. `passage --id …` 로 지문·문장 표 가져오기 (⭐ 표시는 분석기에서 「서술형대비」 체크된 문장).
2. 채팅에서 `assets/exam_kit/generation_prompt.md` 규칙대로 ExamData JSON 을 작성하고 `.essay-drafts/<sourceKey>.json` 에 저장.
3. `save --json … --dry-run` 으로 검증 통과 확인 (단어수·bogi 청크·"N개의 단어" 조건 정합성).
4. 통과 시 `save --json …` 으로 실제 insert. `/admin/essay-generator` 「📂 목록」에서 즉시 보임.

**save JSON 스키마 핵심 키** — `passageId` / `textbook` / `sourceKey` / `difficulty` / `folder` / `examTitle` / `schoolName` / `grade` / `examSubtitle` / `data` (= ExamData). `passageId` 가 있으면 `textbook`/`sourceKey` 자동 보강.

**선택 문장 가드 (`requireSentences`)** — 사용자가 "이 문장을 중심으로 / 변형 없이 그대로 포함" 하라고 특정 문장을 지정하면, 초안 최상위에 **`requireSentences: ["<원문 그대로>"]`** 를 넣어라 (CLI 단발은 `--require-sentence "..."`). `save`/`--dry-run` 이 ① 선택 문장이 정답에 그대로 들어갔는지(누락) + ② 선택 안 한 다른 문장이 문항이 됐는지(외래) 검사해, 어긋나면 **저장 거부** (`reason: required_sentence_guard`, `--force` 로만 우회). 통과 시 응답에 `required_sentences_checked: N`. **다른 문장을 끼워 넣는 실수는 "외래" 검사로만 잡히므로 지정 문장이 있으면 반드시 `requireSentences` 를 채울 것.**

**저장 폴더 자동 생성** — `save` / `save-all` 은 입력 JSON 의 `folder` 가 `essay_exams` 에 한 번도 등장한 적 없으면 placeholder 문서를 1 개 사전 insert 한다 (`/admin/essay-generator` 「📁 새 폴더」 와 동일). 단독 호출도 가능: `npm run cc:essay -- ensure-folder --folder "이름"`.

**한 줄 호출용 워크플로우 프롬프트** (`claude agents` 의 task description 같은 single-line 입력에서도 안전) — `claude agents`/`claude` 채팅에서 매번 멀티라인 프롬프트를 paste 하면 truncate 위험이 있으니 다음을 첨부:
- 자동 채움 (4 난도 생성·저장 1 cycle): `@scripts/cc-essay-loop-prompt.md 워크플로우대로 교재 "<textbook>" 1 cycle 돌려줘.`
- audit-content 검증·개선: `@scripts/cc-essay-audit-prompt.md 워크플로우대로 교재 "<textbook>" 검증해줘.`

**완전 자동화 헬퍼 스크립트** (Pro 전용 · 권한 프롬프트 없이 진짜 hands-off):
```bash
# 한 교재 자동 채움 — 현재 터미널에서 claude 띄우고 ScheduleWakeup 10분 루프
./scripts/run-essay-loop.sh "25년 3월 고1 영어모의고사"

# 여러 교재 병렬 — macOS Terminal.app 새 창 N 개 동시 시작
./scripts/run-essay-loop-multi.sh \
  "25년 3월 고1 영어모의고사" \
  "26년 3월 고3 영어모의고사" \
  "24년 6월 고1 영어모의고사"
```
내부에서 `claude --dangerously-skip-permissions "@scripts/cc-essay-loop-prompt.md …"` 로 실행. **에이전트가 룰을 안 어기는 한 안전**하지만, 잘못 만든 명령도 즉시 실행되므로 새 워크플로우 검증할 때는 일반 `claude` 로 먼저 1 cycle 확인.

**금지** — `variant_generate_draft` 와 같은 이유로, 서술형도 `/api/admin/essay-generator/generate` (Anthropic API) 는 Pro 만으로 운영할 땐 호출하지 말 것. CLI 의 `save` 만 사용.

## 서술형집중 워크북 (Pro 전용 — `cc:essay-step`)

한 지문 종합 8섹션 워크북(표지+본문+어휘+어법+영작+빈칸+해석/구문+주제·요약·제목+종합+정답키). 프리미엄 판매용. **API 키 호출 없음** — Pro 채팅에서 8섹션 JSON 작성 → CLI 가 검증·HTML 생성·저장.

```
npm run cc:essay-step -- textbooks
npm run cc:essay-step -- passages --textbook "..."
npm run cc:essay-step -- passage  --id <passageId>                # EN+KO 문장 표
npm run cc:essay-step -- shortage --textbook "..." [--required 1] [--folder "..."|all]
npm run cc:essay-step -- save --json draft.json [--dry-run] [--force]   # essay_step_workbooks 에 insert
cat draft.json | npm run cc:essay-step -- save --json -
단축: npm run cc:essay-step -- "26년 3월 고1 영어모의고사"
```

**작성 흐름**
1. `passage --id …` 로 EN+KO 문장 표 가져오기
2. 채팅에서 `scripts/cc-essay-step-prompt.md` 규칙대로 8섹션 JSON 작성 (vocab·definitions·grammar_fix/box/passage·word_arrange·ko_to_en·cond_write·inflection·blank_*·translation·syntax·summary·title·comprehensive)
3. `save --json … --dry-run` 으로 검증
4. 통과 시 `save --json …` 으로 저장. `/admin/workbook-maker/essay-step` 에서 활용.

**금지** — `/api/admin/workbook-maker/essay-step/generate` (Anthropic API) 는 Pro-only 운영시 호출 X. CLI `save` 만 사용.

## 블록 빈칸 워크북 (Pro 전용 — `cc:block-workbook`)

`/admin/block-workbook` 와 동일한 데이터를 만드는 CLI. 한 지문에서 단어/구/문장 블록을 골라 **A~F 6 유형(단어 빈칸·구 빈칸·문장 영작·어순 배열·핵심 표현 정리·어법 변형)** 워크북을 동시 생성. **API 키 호출 없음**.

```
npm run cc:block-workbook -- textbooks                                  # 교재 목록
npm run cc:block-workbook -- passages --textbook "26년 3월 고1 영어모의고사"
npm run cc:block-workbook -- passage  --id <passageId>                  # 지문 토큰 표 (sentenceIdx·tokens·korean)
npm run cc:block-workbook -- shortage --textbook "..." [--required 1] [--types ABCDEF|all] [--folder "..."|all]
npm run cc:block-workbook -- save --json draft.json [--dry-run] [--force]
cat draft.json | npm run cc:block-workbook -- save --json -             # stdin (코드펜스 ```json 자동 제거)
단축: npm run cc:block-workbook -- "26년 3월 고1 영어모의고사"          # shortage 와 동일
```

**작성 흐름 (Pro 채팅):**
1. `passage --id …` → 출력의 `sentences` 배열을 채팅에 그대로 붙임
2. `scripts/cc-block-workbook-prompt.md` 의 규칙에 따라 selection JSON 작성
3. `save --json … --dry-run` 로 검증 (블록 인덱스·겹침·types 정합)
4. 통과 시 `save --json …` 으로 실제 insert

**save JSON 필수 키** — `textbook` / `sourceKey` / `title` / `selection.sentences` / `selection.blocks` / `types`. `passageId` 가 있으면 `textbook`/`sourceKey` 자동 보강.

**금지** — `/api/admin/block-workbook/generate` 라우트는 **만들지 않음** (Pro-only 정책). CLI `save` 만 사용. 자동 lemma 추론·자동 한국어 번역 라이브러리 추가 X — 채팅에서 직접 입력하거나 `passages.content.sentences_ko` fallback.

## 지문분석기 (Pro 전용 — `cc:syntax`)

한 지문의 **모든 분석 카테고리**(종합분석·주제문장·서술형대비·어법·문맥·끊어읽기·SVOC·구문·문법태그·문법포인트·단어장) 를 채워 `passage_analyses.passageStates.main` 에 저장. **API 키 호출 없음** — Pro 채팅에서 PassageStateStored JSON 작성 → CLI 검증·저장만.

```
npm run cc:syntax -- textbooks
npm run cc:syntax -- passages --textbook "..."
npm run cc:syntax -- passage  --id <passageId>           # 지문 + 현재 진척률
npm run cc:syntax -- shortage --textbook "..." [--required 100]
npm run cc:syntax -- next-empty --textbook "..." [--required 100]
npm run cc:syntax -- save --json draft.json [--dry-run]  # passageId 는 JSON 안 필드 또는 --passage-id
npm run cc:syntax -- save-all draft1.json draft2.json [--dry-run]
npm run cc:syntax -- export <passageId>                  # 기존 main JSON 덤프
단축: npm run cc:syntax -- "<교재명>"  →  shortage
```

**작성 흐름** — `scripts/cc-syntax-prompt.md` 의 항목별 규칙 참조. 자동 채움 루프는 `@scripts/cc-syntax-loop-prompt.md 워크플로우대로 교재 "<textbook>" 1 cycle 돌려줘`.

**save JSON 스키마** — `{ passageId, main: PassageStateStored }` 또는 `{ passageId, sentences, koreanSentences, ... }` (top-level 본문). 인덱스는 모두 `sentences` 배열 idx 기준 (svocData/syntaxPhrases/grammarTags 의 sentenceIndex / startIndex 등).

**금지** — `passage-analyzer-cli.ts run-ai` (ANTHROPIC API) Pro-only 운영 시 호출 X. CLI `save` 만 사용.

## 대기 vs 신규 작성 (한 번에 보기)

1. **`pendingReviewTotal`** — 이미 DB에 있으나 **status=대기**. 할 일: 문제 풀기 → **`variant_review_pending_record`** → 정답 맞으면 **완료**(첫 시도) 또는 **`attemptNumber`≥2**면 **검수불일치**.
2. **`needCreateGrandTotal`** — **아직 문항 자체가 부족**. 할 일: 지문 가져와 **`variant_save_generated_question`**(또는 채팅에서 작성 후 저장). `needCreateShortBySum`(유형별 부족 합) + `needCreateFromEmptyPassagesTotal`(변형 0건 지문 슬롯)로 분해됨.

**전체(all)** 집계에서 건수는 완료+대기를 합쳐 세므로, 대기만 많으면 **underfilled는 0**이어도 **`pendingReviewTotal`>0** 일 수 있다.

**대기만** 집계(`questionStatus: 대기`)는 부족 계산 방식이 다르다(관리자 화면과 동일).
