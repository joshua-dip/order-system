# 서술형 audit-content 자동 검증·개선 워크플로우 (Pro 전용)

> 저장된 `essay_exams` 의 condition·intent·structure 품질을 검사하고, ERROR 보유 항목을 자동으로 패치한다.
> **API 키 호출 없음** — `audit-content` → 데이터 fetch → 패치 스크립트 작성·실행 → HTML 재빌드. ERROR 가 0 이 될 때까지 반복.

---

## 입력 (호출 방법)

```
@scripts/cc-essay-audit-prompt.md 워크플로우대로 교재 "<textbook>" 의 audit-content ERROR 를 모두 검증·개선해. ERROR 가 0 이 될 때까지 반복.
```

또는 폴더·examId 단위:

```
@scripts/cc-essay-audit-prompt.md 워크플로우대로 폴더 "<folder>" 의 audit-content ERROR 를 모두 검증·개선해.
@scripts/cc-essay-audit-prompt.md 워크플로우대로 examId <id> 의 audit-content ERROR 를 모두 검증·개선해.
```

---

## 점검 체크리스트 (ERROR 판정 기준)

ERROR 보유 항목은 다음 모든 기준을 통과하도록 개선한다:

### 1. SVOC 더블 체크
- `colorizeStructure` 매칭 — unmatched 토큰 0 건
- `structure_analysis` 의 `label` 에 `(S)` / `(V)` / `(O)` / `(C)` / `(M)` 표지 일관성 유지

### 2. 문법 포인트 충분성
- `answer.text` 에 들어있는 문법 구조 대비 `grammar_points` 와 `structure_analysis` 가 충분히 다루는지 확인
- 핵심 문법 구조 1 개 이상이 분석되지 않은 채 답안에 들어가 있으면 ERROR

### 3. 최고난도 문장 길이·복잡도
- Q1 ≥ 25 단어, Q2 ≥ 15 단어
- 최소 3 종 이상의 문법 결합 (예: 분사구문 + 관계절 + 도치 등)
- 7~14 단어의 단순 단문이면 **같은 지문의 다른 문장으로 swap**:
  - 같은 passage 의 문장 후보 중 25 단어 이상 + 다중 문법 결합 문장 선택
  - 새 문장을 기준으로 `answer.text` / `bogi` / `grammar_points` / `structure_analysis` / `intent_content` 전부 재작성

### 4. 합의 룰 (lib/essay-exam-content-audit.ts 기준)
- POS 원자 ≥ 5 연속 (`COND_POS_ENUM`) 없음
- 슬롯(condition 항목) 개수 ≤ 14
- 함수어·내용어 누설 ERROR 없음 (최고난도에서 영어 단어·구 직접 인용 금지)
- 메타용어 화이트리스트만 사용 (`주어`·`동사`·`목적어`·`보어`·`수식어`·`분사구문` 등)
- `intent_content` ≥ 30 자 + 평가능력/감점 포인트 명시적 서술

---

## 실행 순서

### 1. ERROR 위치 파악

```
npm run cc:essay -- audit-content --textbook "<textbook>" --report-md
```

응답 JSON 의 `items` 와 `summary.code_frequency` 를 확보. `findings` 중 `level=error` 인 항목만 개선 대상.

### 2. ERROR 항목별 데이터 fetch

각 ERROR `examId` 마다 MongoDB 에서 현재 데이터를 가져오기:

```typescript
// 패치 스크립트 안에서
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

const db = await getDb('gomijoshua');
const doc = await db.collection('essay_exams').findOne({ _id: new ObjectId(examId) });
// doc.data 가 ExamData. doc.difficulty / doc.folder / doc.sourceKey 보존.
```

### 3. 패치 스크립트 작성·실행

`scripts/patch-essay-<sourceKey-slug>-<timestamp>.ts` 형태로 1 회용 패치 스크립트를 작성:

- 위 4 가지 체크리스트 위반 사항만 수정
- ERROR 없는 항목은 **건드리지 말 것**
- 수정 후:
  - `validateExamData(data, { difficulty })` 로 사전 검증
  - `buildExamHtmlWithOverrides` 로 HTML 재빌드
  - `updateEssayExam(examId, { data, html })` 로 DB 업데이트
- 스크립트 끝에 어떤 examId 가 어떤 ERROR 코드를 어떻게 패치했는지 콘솔 요약 출력

실행:
```
npx tsx scripts/patch-essay-<sourceKey-slug>-<timestamp>.ts
```

### 4. 재검증

같은 `audit-content` 다시 실행 → `summary.with_errors` 가 0 이 되는지 확인.

- 0 이면 사용자에게 완료 보고 후 종료.
- 0 이 아니면 새로운 ERROR 만 골라 step 2~3 반복 (최대 5 회 — 그 이상은 멈추고 사용자 보고).

---

## 작업 디렉터리 규칙 (worktree 금지)

- worktree 만들지 말 것. 본질이 MongoDB Atlas 쓰기라 격리 불필요.
- 모든 `npm run cc:essay -- ...` 호출은 메인 디렉터리(`/Users/goshua/next-order`) 에서 실행.
- `scripts/patch-essay-*.ts` 도 메인의 `scripts/` 에 작성.

## 셸 명령 작성 규칙

- `for`·`while` 루프, 셸 변수 확장(`$VAR`, `${...}`), `xargs` 사용 금지 (Claude Code 권한 시스템의 `simple_expansion` 회피).
- 여러 examId 처리는 패치 스크립트(TypeScript) 안에서 반복문으로 처리, 셸 루프 X.

---

## 금지 사항

- `/api/admin/essay-generator/generate` (Anthropic API) 호출 금지.
- `audit --fix` 자동 적용 금지 (`audit --fix` 는 word_count 등 표면 패치만 함). 본 워크플로우는 내용 품질 개선이므로 패치 스크립트로 직접 수정.
- ERROR 없는 항목 수정 금지.
- 같은 examId 에 새 doc 을 insert 하지 말 것 (`save` 가 아니라 `updateEssayExam` 사용).
- `--force` 자동 사용 금지 — `validateExamData` 가 실패하면 패치 안 함.

---

## 출력 톤 (사용자 보고)

작업 시작:
```
🔍 audit-content 1 패스 — 「<textbook>」
  total=<N>  errors=<E>  warnings=<W>  clean=<C>
  주요 ERROR 코드: <code1>×<n1>, <code2>×<n2>, ...
```

각 사이클 후:
```
🛠 패치 <round>회차 — <patched> 건 수정
  • examId=<id> · <sourceKey> · <difficulty>
    수정: <code> → <간단 설명>
```

종료:
```
✅ 「<textbook>」 audit-content 완료 — ERROR 0 (총 <patched> 건 수정, <round> 사이클)
```
또는 한도 도달 시:
```
⚠️ 5 사이클 후에도 ERROR <n> 건 잔존 — 사용자 검토 필요
  잔존 항목: examId=<id> · <findings>
```
