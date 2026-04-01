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
| 문제 저장 | `variant_save_generated_question` (또는 CLI: `npm run cc:variant -- save --json …`) |
| 주제·빈칸 등 **새 문항 만들기 (Pro만)** | `variant_get_passage` → **채팅에서** JSON 작성 → `variant_save_generated_question` (**`variant_generate_draft` 금지**) |

**터미널만 (MCP 없이):** `npm run cc:variant -- --help` · **주문 한 방:** `npm run claude -- claude:BV-20260331-002` (또는 `npm run cc:variant -- claude:BV-…` / `npm run cc:variant -- BV-…`) · 프로젝트 루트에서 실행 권한이 있으면 `./claude claude:BV-20260331-002` (`claude` 스크립트가 `tsx`로 CLI를 호출).

## 대기 vs 신규 작성 (한 번에 보기)

1. **`pendingReviewTotal`** — 이미 DB에 있으나 **status=대기**. 할 일: 문제 풀기 → **`variant_review_pending_record`** → 정답 맞으면 **완료**(첫 시도) 또는 **`attemptNumber`≥2**면 **검수불일치**.
2. **`needCreateGrandTotal`** — **아직 문항 자체가 부족**. 할 일: 지문 가져와 **`variant_save_generated_question`**(또는 채팅에서 작성 후 저장). `needCreateShortBySum`(유형별 부족 합) + `needCreateFromEmptyPassagesTotal`(변형 0건 지문 슬롯)로 분해됨.

**전체(all)** 집계에서 건수는 완료+대기를 합쳐 세므로, 대기만 많으면 **underfilled는 0**이어도 **`pendingReviewTotal`>0** 일 수 있다.

**대기만** 집계(`questionStatus: 대기`)는 부족 계산 방식이 다르다(관리자 화면과 동일).
