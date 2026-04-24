# 가입신청 시스템 구축 플랜

## 목표
비로그인 사용자가 AppBar의 "가입신청" 버튼으로 모달을 열어 학생/학부모/선생님 신청서(이름·전화)를 제출하고,
관리자 웹의 새 메뉴에서 신청서를 확인·처리할 수 있는 시스템.
제출 후 완료 화면에서 01079270806으로 SMS 딥링크(`sms:`) + `tel:` 딥링크를 안내.

---

## 1. 데이터 모델 — `membership_applications` 컬렉션

### lib/membership-applications-store.ts (신규)

```ts
export type MembershipApplicantType = 'student' | 'parent' | 'teacher';
export type MembershipApplicationStatus = 'pending' | 'contacted' | 'completed' | 'rejected';

export type MembershipApplicationDoc = {
  _id?: ObjectId;
  applicantType: MembershipApplicantType;   // 학생 / 학부모 / 선생님
  name: string;                              // 이름 (2~30자)
  phone: string;                             // 010-xxxx-xxxx (정규화 저장)
  status: MembershipApplicationStatus;       // 기본 'pending'
  adminMemo?: string;
  appliedAt: Date;
  contactedAt?: Date;
  completedAt?: Date;
  rejectedAt?: Date;
  ip?: string;                               // 중복·스팸 방지용
  userAgent?: string;
  createdAt: Date;
  updatedAt: Date;
};
```

**스토어 함수:**
- `createApplication(data, ip?)` — 삽입 + 반환
- `listApplications({ status?, search?, limit })` — 조회
- `getApplication(id)` — 단건
- `updateApplicationStatus(id, nextStatus, memo?)` — 상태 전환 + 타임스탬프
- `deleteApplication(id)` — 하드 삭제
- `countPendingApplications()` — 미처리 건수(배지용)

**전화번호 정규화:** 숫자만 추출 후 `010-xxxx-xxxx` 포맷 저장.

---

## 2. 인덱스 스크립트

### scripts/init-membership-applications-indexes.ts (신규)

- `{ status: 1, appliedAt: -1 }`
- `{ phone: 1, appliedAt: -1 }` (중복 신청 조회용)

---

## 3. Public API — 비로그인 허용

### POST /api/membership-applications (신규)
`app/api/membership-applications/route.ts`

**요청:** `{ applicantType, name, phone }`

**검증:**
- `applicantType ∈ {student, parent, teacher}`
- `name`: 2~30자
- `phone`: 010 시작 11자리 숫자

**보호:**
- 동일 전화 24h 내 중복 신청 차단 → 400
- IP 기준 1h 5건 초과 → 429

**응답:**
```json
{
  "ok": true,
  "id": "...",
  "smsTarget": "01079270806",
  "smsBody": "[학생 가입 신청] 홍길동 / 010-1234-5678",
  "telTarget": "01079270806"
}
```

**SMS 본문 템플릿 (applicantType별):**
- 학생: `[학생 가입 신청] {이름} / {전화}`
- 학부모: `[학부모 가입 신청] {이름} / {전화}`
- 선생님: `[선생님 가입 신청] {이름} / {전화}`

**middleware.ts 확인:** 보호 라우트 매처에서 `/api/membership-applications` 예외 처리 필요 시 추가.

---

## 4. 관리자 API

### GET /api/admin/membership-applications (신규)
`app/api/admin/membership-applications/route.ts`

- `requireAdmin` 보호
- 쿼리: `status`, `search`(이름/전화), `limit`
- 응답: `{ applications, pendingCount }`

### PATCH/DELETE /api/admin/membership-applications/[id] (신규)
`app/api/admin/membership-applications/[id]/route.ts`

**PATCH 액션:**
- `markContacted` → status: contacted + contactedAt
- `markCompleted` → status: completed + completedAt
- `markRejected` → status: rejected + rejectedAt
- `updateMemo` → adminMemo 업데이트

**DELETE:** 하드 삭제

---

## 5. 프론트 — 가입신청 모달

### app/components/MembershipApplyModal.tsx (신규)

**3-step UX:**

**Step 1 — 유형 선택**
카드 3개: 학생 / 학부모 / 선생님 (아이콘 + 한 줄 설명)

**Step 2 — 정보 입력**
- 이름 텍스트 입력
- 전화번호 (onChange에서 자동 하이픈: `01012345678` → `010-1234-5678`)
- 제출 버튼

**Step 3 — 완료 화면**
```
신청이 접수되었습니다 ✓

신청하신 번호(010-xxxx-xxxx)로
아래 버튼을 눌러 문자를 보내주시면 더 빠르게 확인됩니다.

[01079270806으로 문자 보내기]  →  sms:01079270806?body=...
[전화 걸기]                     →  tel:01079270806
[복사하기]  (데스크톱 fallback, 클립보드에 SMS 본문 복사)
```

**공통:** ESC / 배경 클릭 닫기, 제출 중 로딩 스피너, 에러 인라인 표시.

---

## 6. AppBar 변경

### app/components/AppBar.tsx (수정)

- `useState<boolean>(false)` → `applyOpen`
- 비로그인 분기(`!user`)에서 "로그인" 버튼 **왼쪽**에 가입신청 버튼 추가:
  - `bg-amber-400 text-slate-900 font-bold` 강조 스타일
  - 데스크톱·모바일 모두 "가입신청" 라벨
  - 클릭 → `setApplyOpen(true)`
- 모달: `<MembershipApplyModal open={applyOpen} onClose={() => setApplyOpen(false)} />`
- **로그인 사용자에게는 버튼 숨김**

---

## 7. 관리자 페이지 — 신청서 관리

### app/admin/membership-applications/page.tsx (신규)

`app/admin/enrollments/page.tsx` 패턴 재사용:

- **탭:** 대기 / 연락완료 / 가입처리완료 / 거절
- **검색:** 이름·전화 통합 검색
- **카드 행:**
  - 유형 배지 (학생/학부모/선생님 색상 구분)
  - 이름
  - 전화번호 (클릭 → `tel:`, 길게 클릭 → `sms:`)
  - 신청 일시
  - 관리자 메모 (인라인 편집)
  - 액션 버튼: 「연락완료」「가입처리완료」「거절」「삭제」

### app/admin/page.tsx 사이드바 수정

`MEMBERS` 섹션 상단(라인 2413~)에 링크 추가:

```tsx
<Link href="/admin/membership-applications" className="...flex items-center justify-between">
  <span>가입 신청 관리</span>
  {pendingApplyCount > 0 && (
    <span className="bg-red-500 text-white text-xs ...">{pendingApplyCount}</span>
  )}
</Link>
```

배지 카운트: `loadStats()`에서 `/api/admin/membership-applications?status=pending&limit=1` 호출 → `pendingCount` 사용.

---

## 8. 구현 순서 (Todo)

1. `lib/membership-applications-store.ts` — 타입/CRUD 유틸 + 전화번호 정규화
2. `scripts/init-membership-applications-indexes.ts` — 인덱스 생성
3. `POST /api/membership-applications` — 비로그인 제출, rate limit, SMS 포맷
4. `GET /api/admin/membership-applications` — 목록 + pendingCount
5. `PATCH/DELETE /api/admin/membership-applications/[id]` — 상태 전환·메모·삭제
6. `app/components/MembershipApplyModal.tsx` — 3-step 모달
7. `app/components/AppBar.tsx` — 비로그인 시 가입신청 버튼 + 모달 연결
8. `app/admin/membership-applications/page.tsx` — 탭/검색/액션 UI
9. `app/admin/page.tsx` 사이드바 — 가입 신청 관리 링크 + 미처리 배지
10. `middleware.ts` 비로그인 POST 허용 확인
11. `tsc --noEmit + ReadLints` 검증
