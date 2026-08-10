# 국어 해설지 생성기 통합 계획

> 입력 자료: `/Users/goshua/Downloads/files 4/` ( `START_HERE.md`, `INTEGRATION_SPEC.md`, `BLOCK_CATALOG.md`, `reference_styles.css`, `sample_set_22-25.json` )
>
> 외부 스펙의 핵심 원칙은 그대로 따른다: **디자인은 고정, 갈래 차이는 블록 조합(데이터)으로 흡수.** 갈래별 if/else 금지.

## 0. 목표 한 줄

운영 중인 `next-order` (Next.js 15, App Router, MongoDB) 에 **모의고사 국어 해설지 생성·미리보기·PDF 출력** 기능을 이식한다. 사이드바에 신규 「국어」 섹션을 **로즈/핑크 톤**으로 추가해 영어(slate) 와 시각적으로 분리한다.

### 0-1. 운영 범위 (★ 본 PLAN 의 경계)

**`essay-generator` 와 정확히 동일한 운영 범위 — admin 전용 생성기.**

| 포함 | 제외 (본 PLAN 범위 밖) |
|---|---|
| 관리자가 해설지를 작성·미리보기·인쇄·PDF 저장 | 학생/회원 노출, 주문·상품 연결, 결제 |
| `korean_explanations` 컬렉션에 insert/update/delete | 학생용 라우트, 마이페이지·다운로드 자료 노출 |
| Pro 채팅 + CLI 로 데이터 작성 후 저장 | LLM API 호출 라우트 (`/api/.../generate`) |
| 기존 admin 미들웨어로 자동 보호 | 별도 권한 모델, 검수 워크플로 |

> 학생 노출·주문 연결이 필요해지면 그때 별도 PLAN 으로 분리. 본 PLAN 에서는 "해설지를 잘 뽑는다" 한 가지만.

### 0-2. 비문학 우선 · 문학은 데이터 IMPORT 후속 (★ 워크플로 분리)

| 갈래 | 작성 방식 | 도입 시점 |
|---|---|---|
| **비문학** — 독서(인문·사회·과학), 화법/작문, 문법 | Pro 채팅에서 지문 분석 → 블록 JSON 생성 → 저장 | **본 PLAN — 1차** |
| **문학** — 현대소설, 현대시, 고전시가, 고전소설 | 이미 외부에 정리된 작품별 데이터(인물·시상흐름·고어 풀이) 를 import → 블록 매핑 | **후속 epic — import 파이프라인 정해진 뒤** |

**근거.** 비문학은 지문 자체를 분석해 요약·대조·개념·과정도해를 만드는 작업이라 본문만 있어도 작성이 가능. 반면 문학은 작품마다 인물·시상흐름·고전어 풀이가 **표준화된 외부 정리물**로 이미 존재할 가능성이 높아, 같은 분석을 새로 짜는 건 중복. 그 데이터를 받아 `character_grid`/`emotion_flow`/`sijo_box`/`timeline` 블록에 매핑하는 게 효율적.

**렌더링 코어 영향: 없음.** 13종 블록 렌더러는 갈래 무관(BLOCK_CATALOG 원칙 그대로). 본 PLAN 의 PR #2 는 13종 전체를 구현해 둔다 — 문학 데이터가 import 되는 순간 추가 코드 없이 그대로 렌더된다.

**편집기(PR #3) 영향: 있음.** 비문학에서 자주 쓰는 블록(`info_box`, `paragraph_table`, `compare_2col`, `concept_grid`, `process_diagram`, `gist_box`, `question`)의 전용 폼만 먼저 만든다. 문학 전용 블록(`character_grid`, `timeline`, `emotion_flow`, `sijo_box`)의 폼은 import 파이프라인이 결정된 뒤 후속 epic 에서 추가 — 그 전에도 JSON 직편집 토글로 입력은 가능하다.

**갈래 드롭다운 영향: 약함.** 1차에서는 `genre` 드롭다운에 7개 모두 노출하되, 비문학 3개(독서·화법/작문·문법) 위에 별도 묶음으로 두고 문학 4개는 "(import 대기)" 표시. 데이터 모델·라우트는 1차에서 모두 동일하게 작동.

---

## 1. 코드베이스 현황 보고 (INTEGRATION_SPEC §1 대응)

| 항목 | 실측값 | 근거 |
|---|---|---|
| Next.js | 15.5.3 / **App Router** / TypeScript | [package.json](package.json:35) |
| 인증 | 자체 JWT (`jose`) + MongoDB 세션 | [middleware.ts](middleware.ts), `app/api/auth/*` |
| PDF 파이프라인 | **WeasyPrint / Python 서비스 없음.** `jspdf` + `html2canvas` 클라이언트 PDF + 브라우저 인쇄(`window.print`)만 존재 | [package.json](package.json:51), [app/admin/essay-generator/page.tsx](app/admin/essay-generator/page.tsx) PRINT_FIX_CSS·새 창 인쇄 패턴 |
| 기존 문서 생성기 | `essay-generator` (서술형), `block-workbook` (워크북), `workbook-maker/*`, `variant` — **모두 새 창 + print stylesheet + (선택) jsPDF 다운로드** 패턴 | [scripts/cc-essay-cli.ts](scripts/cc-essay-cli.ts), [scripts/cc-block-workbook-cli.ts](scripts/cc-block-workbook-cli.ts) |
| 데이터 모델 | `passages`(원문) · `generated_questions`(변형) · `essay_exams`(서술형) · `block_workbook_*`(워크북) | [lib/](lib/) 스토어 모듈 |
| 한글 폰트 | 서버측 폰트 없음. 화면/인쇄 모두 브라우저 폰트 사용 | (CSS 로 `Noto Sans/Serif CJK KR` 폴백) |

### → 통합 분기 권장: **B-2 변형 (Node-only, HTML+CSS 인쇄 / 클라이언트 PDF)**

이유:
1. Python 서비스가 **전무**하다. 신설하면 배포(amplify.yml, Lambda 구성) 변경이 필요해 비용·리스크가 크다.
2. 동일 도메인의 `essay-generator` / `block-workbook` / `variant` 가 이미 같은 패턴(HTML 미리보기 → 새 창 인쇄 → jsPDF 옵션)으로 운영 중. 국어 해설지를 **그 옆자리에 그대로** 끼워 넣으면 인증·라우팅·저장 컨벤션이 자동으로 들어맞는다.
3. `reference_styles.css` 의 `@page` / `@bottom-center` / `page-break-*` 규칙은 **WeasyPrint 전용이 아니라** 현대 브라우저 인쇄 엔진에서도 거의 그대로 동작한다. 차이만 두 군데(@top-right 헤더, `tr.correct` 색상 인쇄 색 보정)를 보정 CSS 로 덮어쓰면 된다.
4. `puppeteer` 도입(B-2 정공법)도 가능하지만, 단지 PDF 한 종을 위해 Chromium 200MB+ 의존성을 amplify 빌드에 추가하는 건 과하다. 필요 시 후속 단계로 분리.

> **불변식**: 입력은 `BLOCK_CATALOG.md` 의 JSON 스키마, 디자인은 `reference_styles.css`, 갈래 분기는 데이터로만. 이 셋은 이식 과정에서 절대 흔들지 않는다.

---

## 2. 사이드바 「국어」 섹션 추가

[app/admin/_components/AdminSidebar.tsx](app/admin/_components/AdminSidebar.tsx) 의 `UPLOADS` 그룹 아래에 신규 그룹을 삽입한다. 톤은 **rose** (text-rose-200/90, hover bg-rose-950/40, border-rose-800/40). 영어=slate, Claude 검수 로그=emerald, 비회원=amber 와 충돌하지 않는다.

```
KOREAN  ────────────────────────────────────────  (uppercase tracking-wider, slate-500)
  국어 원문 관리        /admin/korean/passages
  국어 변형문제 관리     /admin/korean/questions
  국어 해설지 생성기     /admin/korean/explainer       ← ★ 본 기능
  국어 워크북 (TBD)     /admin/korean/workbook        (자리만 잡고 disabled)
```

링크 클래스 규칙(영어 essay-generator 와 동일 변주):

```tsx
const koreanLinkCls = (href: string) =>
  `block w-full text-left px-4 py-2.5 rounded-lg font-medium transition-colors border ${
    isActive(href)
      ? 'bg-rose-700/30 text-rose-50 border-rose-700/50'
      : 'text-rose-200/90 hover:bg-rose-950/40 border-rose-800/40'
  }`;
```

> 접힌 상태(`collapsed`) 의 활성 점도 `bg-rose-400` 으로 동시 추가.

**1차 PR 범위는 사이드바 + 빈 페이지 4개 스텁만.** 색·자리만 먼저 확정해 시각적 합의를 본 뒤 본 구현에 들어간다.

---

## 3. 데이터 모델

기존 `passages` / `generated_questions` 는 **영어 전용**으로 두고, 국어는 별도 컬렉션으로 격리한다. (스키마가 다르고, 영어 변형 부족 집계 로직이 영향받지 않게.)

### 3-1. `korean_passages`
```ts
{
  _id: ObjectId,
  textbook: string,            // "2025학년도 3월 고1 국어 모의고사"
  source_key: string,          // "25-03-go1-22-25"  (set_range 포함)
  set_range: string,           // "22-25"
  genre: string,               // "현대소설" | "현대시" | "고전시가" | "독서" | "문법" | "화법/작문" | "고전소설"
  work_title: string,          // "이문구 「암소」"
  questions_range: { from: number, to: number },
  raw_text?: string,           // 지문 원문 (필요 시)
  created_at: Date,
  updated_at: Date,
}
```

### 3-2. `korean_explanations` (해설지 본체)
```ts
{
  _id: ObjectId,
  passage_id: ObjectId,        // korean_passages 참조
  textbook, source_key, set_range, genre, work_title, exam_title, show_subtitle,
  blocks: Block[],             // ★ BLOCK_CATALOG.md 스키마 그대로
  status: '대기' | '검수완료' | '검수불일치',
  created_at, updated_at,
  created_by: 'cc:korean-explain' | 'admin:web' | string,
}
```

`Block` 타입은 [lib/korean-explainer/types.ts](lib/korean-explainer/types.ts) 에 정의 (TypeScript 디스크리미네이티드 유니온 13종).

### 3-3. 외부 스펙 스키마 ↔ 내부 저장의 매핑 원칙
- 외부 `*_html` 필드는 그대로 보관·렌더 (sanitize 는 입력 단계에서 1회).
- `cover` 블록의 `exam_title` / `set_range` / `genre` / `work_title` 은 최상위 메타와 중복 — 저장 시 자동 동기화 (외부 입력 우선).

---

## 4. 라우트 / UI

### 4-1. 신설 페이지
| 경로 | 역할 |
|---|---|
| `/admin/korean/passages` | 국어 원문 목록·등록·편집 (영어 `passages` 와 동일 톤) |
| `/admin/korean/explainer` | **해설지 생성기 본체.** 좌: 메타·블록 편집기 · 우: 실시간 HTML 미리보기 + 「새 창 인쇄」/「PDF 저장」 |
| `/admin/korean/explainer/list` | 저장된 해설지 목록 (편집/복제/삭제) |
| `/admin/korean/questions` | (후속) 국어 변형문제 관리 — 2차 PR 이상 |

### 4-2. 해설지 생성기 화면 흐름
1. **상단 메타**: textbook, set_range, genre(드롭다운 — 7갈래), work_title, show_subtitle, passage_id 선택(passage picker).
2. **블록 편집기**: 좌측에서 `+` 로 13종 중 추가 → 순서 드래그 → 각 블록의 폼(예: `paragraph_table` 은 컬럼/행 표 입력 위젯, `question` 은 5지선다 위젯). 데이터는 JSON 으로 직편집 토글 제공.
3. **실시간 미리보기**: 우측 iframe 또는 동일 페이지 `<article>` 에 `reference_styles.css` 적용해 그대로 렌더. A4 비율 모의(595×842) 와 인쇄 모드 토글.
4. **출력**:
   - 「새 창 인쇄」 — essay-generator 와 동일하게 `window.open` → `document.write` → `window.print` (서버 PDF 의존성 0)
   - 「PDF 저장(jsPDF)」 — `html2canvas` 캡처 후 페이지 분할 (옵션, 화질 우선용)
5. **저장**: `POST /api/admin/korean-explainer/save` → `korean_explanations` insert/update.

### 4-3. API 라우트 (3개만)
| 메소드 + 경로 | 역할 |
|---|---|
| `GET /api/admin/korean-passages` | 목록·검색 |
| `POST /api/admin/korean-passages` | 신규/수정 |
| `POST /api/admin/korean-explainer/save` | 해설지 insert/update |
| `GET /api/admin/korean-explainer/:id` | 단건 조회 |
| `DELETE /api/admin/korean-explainer/:id` | 삭제 |

> **Claude API 라우트는 만들지 않는다.** CLAUDE.md 의 "Pro 만으로 가능한 경로" 원칙대로, 해설 본문 데이터는 Pro 채팅에서 작성 → CLI 가 검증·저장만 담당.

---

## 5. 렌더링 코어 (Block 디스패치)

`reference_styles.css` 는 [lib/korean-explainer/styles.css](lib/korean-explainer/styles.css) 에 **그대로** 복사. 그 외 보정은 별도 `print-fix.css` 에만 둔다 (원본 변경 금지).

```ts
// lib/korean-explainer/render.ts
const RENDERERS: Record<BlockType, (data: any) => string> = {
  cover:           renderCover,
  section_header:  renderSectionHeader,
  info_box:        renderInfoBox,
  paragraph_table: renderParagraphTable,
  timeline:        renderTimeline,
  character_grid:  renderCharacterGrid,
  compare_2col:    renderCompare2col,
  concept_grid:    renderConceptGrid,
  process_diagram: renderProcessDiagram,
  emotion_flow:    renderEmotionFlow,
  sijo_box:        renderSijoBox,
  gist_box:        renderGistBox,
  question:        renderQuestion,
};

export function renderExplanation(doc: KoreanExplanation): string {
  return doc.blocks.map(b => RENDERERS[b.type](b.data)).join('\n');
}
```

- 갈래별 if/else 금지 — `type → 렌더러` 한 줄 디스패치만.
- React 컴포넌트로도 1:1 매핑 (`<CoverBlock data={...}/>` …) — 미리보기는 React, 인쇄·저장은 동일 데이터로 서버 문자열 렌더 또는 클라이언트 `renderToStaticMarkup`.
- `*_html` 필드는 **sanitize 후** `dangerouslySetInnerHTML` (sanitizer: 화이트리스트 — `span.hl-key/hl-term/hl-cause/hl-effect`, `strong`, `em`, `u`, `br`).

### 통합본 (cover + 정답표 + 목차)
- 단일 세트 출력은 `cover` 블록만으로 충분.
- 여러 세트 합본은 **후속 단계**. 이번 1차 범위는 세트 단위(`set_range`) PDF 한 장씩.

---

## 6. CLI — `cc:korean-explain` (Pro 전용)

`scripts/cc-korean-explain-cli.ts` + `scripts/cc-korean-explain-prompt.md` (Pro 채팅용 작성 규칙) 두 파일.

```
npm run cc:korean-explain -- textbooks                                     # 교재 목록
npm run cc:korean-explain -- passages --textbook "2025학년도 3월 고1 국어 모의고사"
npm run cc:korean-explain -- passage  --id <korean_passage_id>             # 지문·기존 해설 메타
npm run cc:korean-explain -- shortage --textbook "..."                     # 해설 미작성 set 목록
npm run cc:korean-explain -- save --json draft.json [--dry-run] [--force]  # 검증·렌더·insert
cat draft.json | npm run cc:korean-explain -- save --json -                # stdin (코드펜스 자동 제거)
단축: npm run cc:korean-explain -- "2025학년도 3월 고1 국어 모의고사"      # shortage 와 동일
```

검증 항목 (dry-run 으로 통과해야 save 통과):
- 13종 외 `type` 차단
- `question` 블록: `correct_n` 이 `choices[n]` 안에 존재, `answer` 와 일치(①②③④⑤ 1자만 허용)
- `compare_2col`: 좌우 `items_html` 개수 동일
- `paragraph_table`: 행마다 `cells.length == columns.length`
- `emotion_flow`: `arrow_labels.length == stages.length - 1`
- `*_html` 필드 sanitize 후 차이 발생 시 경고

> `cc:variant`/`cc:essay` 와 동일하게 **API 호출 0**. 데이터는 Pro 채팅에서 사람·Claude 가 직접 작성한다.

---

## 7. 구현 순서 (각 단계 후 동작 확인 → 멈춤)

INTEGRATION_SPEC §3-5 + 본 코드베이스 컨벤션에 맞춰 5 단계로 끊는다.

1. **사이드바 + 스텁 페이지 (PR #1) — ✅ 완료**
   - `AdminSidebar` 에 KOREAN 그룹 (rose) + 4개 링크
   - `app/admin/korean/{passages,explainer,explainer/list,questions}/page.tsx` 빈 스텁

2. **블록 카탈로그 + 렌더러 (PR #2) — 진행 중**
   - `lib/korean-explainer/types.ts` (Block 13종 타입 — **비문학·문학 공통**)
   - `lib/korean-explainer/styles.css` (reference 그대로) + `print-fix.css`
   - `lib/korean-explainer/render.ts` (서버 문자열) + `lib/korean-explainer/blocks/*.tsx` (React 미리보기)
   - 검증: `sample_set_22-25.json` (소설 1세트) + 비문학 샘플 1세트 → HTML 출력 시각 회귀

3. **해설지 생성기 페이지 — 비문학 우선 (PR #3)**
   - `/admin/korean/explainer` 좌:편집기 / 우:미리보기
   - 편집기 폼: **비문학 7블록만 전용 UI** (info_box, paragraph_table, compare_2col, concept_grid, process_diagram, gist_box, question) + 공통(cover, section_header)
   - 문학 4블록(character_grid, timeline, emotion_flow, sijo_box)은 **JSON 직편집 토글**로만 입력 가능
   - `POST /api/admin/korean-explainer/save` + `korean_explanations` 스토어
   - 「새 창 인쇄」 + 「PDF 저장(jsPDF)」 두 버튼

4. **CLI + 검증 (PR #4)**
   - `scripts/cc-korean-explain-cli.ts` + `prompt.md` (**비문학 작성 규칙 위주**)
   - `package.json` 에 `cc:korean-explain` 등록
   - CLAUDE.md 에 절차 추가

5. **회귀·다듬기 (PR #5) — ✅ 완료**
   - 비문학 3갈래(독서·화법/작문·문법) + 문학 1갈래(현대소설) 각 1세트 fixture 작성
     [scripts/fixtures/korean-explain/](scripts/fixtures/korean-explain/) 에 4개 JSON
   - 일괄 회귀 도구: [scripts/cc-korean-explain-render-fixtures.ts](scripts/cc-korean-explain-render-fixtures.ts) — 검증 + standalone HTML 생성 (`public/__korean-regression/`)
   - 인쇄 보정 (검증된 함정 5종 대응):
     - 빈 페이지 — `.cover-title { page-break-after: avoid }`, `.section-header { page-break-after: avoid }` 등으로 강제 break 누수 차단. 검증된 함정 §1.
     - 한글 폰트 — 브라우저 렌더(클라이언트 측)라 OS/브라우저 Noto CJK 폴백. 서버 폰트 불필요. 검증된 함정 §2 무해화.
     - WeasyPrint 의존성 — Python 미사용으로 **해당 없음**. §3 무해화.
     - 인쇄 색 보정 — `print-color-adjust: exact` 를 `.section-header`/`.q-num`/`.q-answer`/`tr.correct td`/`.trap-box` 등 색이 본 컨텐츠인 요소 전체에 강제. `print-fix.css` 의 셀렉터 목록.
     - 다크 모드 누수 — `html, body { background: #fff }` 강제로 브라우저 다크 모드에서 검은 배경 비치는 현상 차단.
   - 발견·수정: `print-fix.css` 의 `.q-block` / `.q-evidence` / `.q-trap` / `.q-choices` 셀렉터가 실제 HTML 클래스(`.question-block` / `.evidence-box` / `.trap-box` / `table.choice-table`)와 어긋나던 것 정정. 색 보존 + 페이지 분리 모두 정상 적용 확인.
   - 통합본(표지+정답표+목차) · 문학 import 파이프라인 · 문학 전용 폼 → **별도 epic** 으로 분리.

### 5-1. 후속 epic 후보 (본 PLAN 범위 밖)

| epic | 트리거 | 내용 |
|---|---|---|
| **korean_passages 컬렉션 + CRUD** | passageId 참조가 필요해질 때 | `/admin/korean/passages` 실 페이지 + 스토어 + CLI 의 `passages` / `passage` / `shortage` 명령 |
| **문학 데이터 import** | 외부 정리물 포맷 결정 후 | character_grid · timeline · emotion_flow · sijo_box 매핑 파이프라인 |
| **문학 전용 폼** | import 파이프라인 안정화 후 | 위 4종 React 폼 (현재는 JSON 직편집만) |
| **통합본 (cover + 정답표 + 목차)** | 여러 세트를 한 PDF 로 묶을 필요가 생길 때 | 정답 11열 그리드 · 3점 노란 배경 · 페이지 역산 |
| **학생/주문 노출** | 해설지를 회원 자료로 판매할 때 | 권한 매트릭스 · 학생 라우트 · 다운로드 자료 연결 |

---

## 8. 검증된 함정 (외부 스펙 §4 → 본 환경 대응)

| 함정 | 본 환경 대응 |
|---|---|
| WeasyPrint 빈 페이지 | 브라우저 인쇄에서도 `page-break-before:always` 남용 시 동일 증상. `cover` 끝과 `section_header` 사이만 break 허용. |
| 한글 □□□ | 클라이언트 렌더라 브라우저 폰트로 OK. PDF 다운로드(jsPDF) 경로에서만 base64 임베드(NotoSerifCJK) 필요. |
| WeasyPrint 시스템 의존성 | **해당 없음** (Python 미사용). |
| 목차 쪽번호 | 1차 범위 밖. 통합본 epic 에서 다룸. |
| Node 분기 페이지 분리 차이 | **본 환경의 주요 리스크.** PR #2 단계에서 `sample_set_22-25.json` 으로 시각 회귀 스냅샷 1회 확보. |

---

## 9. 보안·운영 점검

- `dangerouslySetInnerHTML` 대상은 **admin 입력만**. 본 PLAN 범위에는 학생 노출이 없어 추가 sanitize 단계 불필요 (0-1 참고).
- `MONGODB_URI` 출력 금지 원칙(CLAUDE.md) 그대로 유지 — 본 작업은 새 컬렉션 2개만 추가, 연결 문자열 노출 경로 없음.
- Pro 만으로 운영: `/api/admin/korean-explainer/generate` (LLM 호출) **만들지 않음.** `save` 만 존재.
- amplify.yml / 환경변수 / Python 런타임 — **변경 없음.** 본 PLAN 은 Next.js 안에서만 완결.

---

## 10. 진행 승인 후 처음 작업할 파일 (참고)

- [app/admin/_components/AdminSidebar.tsx](app/admin/_components/AdminSidebar.tsx) — KOREAN 그룹 + rose 클래스
- `app/admin/korean/explainer/page.tsx` — 스텁 ("준비 중 (PR #2)")
- `app/admin/korean/passages/page.tsx` — 스텁
- `app/admin/korean/explainer/list/page.tsx` — 스텁
- `app/admin/korean/questions/page.tsx` — 스텁(disabled 표시)

본 문서 승인 후 위 5개로 **PR #1** 부터 시작한다.
