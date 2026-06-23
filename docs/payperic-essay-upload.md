# 조건영작배열 → payperic 자동 업로드

서술형 출제기(`/admin/essay-generator`)에서 만든 **조건영작배열**(essay_exams)을
payperic 커머스 사이트(`wagent`)의 **상품**으로 한 번에 올리고, 올라갔는지 확인하는 기능.

기존엔 `payperic/scripts/upload-<배치>.ts` 를 배치마다 손으로 짜서 돌렸는데,
이걸 출제기 버튼 한 번으로 대체한다. 제목·가격·태그·카테고리는 그 스크립트와
**완전히 동일**하게 생성되어, 이미 올라간 상품과 제목으로 중복 판정(skip)된다.

## 구조

```
next-order(출제기)                                  payperic(커머스, wagent)
─────────────────                                   ─────────────────────────
교재 essay_exams ──┐
                   │ 번호별/난도별 PDF 렌더(puppeteer)
                   │ 풀세트 ZIP 구성
                   ▼
   각 상품마다:  ① POST /presign  ───────────────▶  presigned PUT URL 발급
                ② S3 로 직접 PUT (파일 본문)  ────▶  S3(wagent-products)  ※6MB 한계 우회
                ③ POST  (메타+s3Key) ───────────▶  Product 생성(멱등, batch:<교재> 태그)
   상태확인:    POST /status {titles} ──────────▶  존재하는 제목 반환
```

- 트리거: 출제기「📂 저장된 문제 목록」 우측 상단 **payperic 업로드 바**(교재별 버튼).
- 인증: 서버-서버 공유 시크릿 헤더 `x-ingest-secret`(관리자 세션과 별개).
- 상품 구성(교재 1개당): 번호별(문항당 800원·18~20번 무료) + 난도별 4종(3,900원) + 풀세트 ZIP(14,000원), `category=grade{1,2,3}-material`.

## 환경변수

**next-order** (`.env.local` / Amplify)
```
PAYPERIC_INGEST_URL=https://<payperic-host>/api/admin/products/ingest
PAYPERIC_INGEST_SECRET=<무작위 시크릿>
```
**payperic** (`.env.local` / Amplify) — 같은 시크릿
```
PAYPERIC_INGEST_SECRET=<같은 값>
```
시크릿 생성: `openssl rand -hex 32`. 미설정 시 출제기 배지는 「미설정」으로 표시되고
ingest 라우트는 503 으로 비활성.

## 코드 위치

- payperic: `app/api/admin/products/ingest/{presign,,status}/route.ts`, `src/lib/ingestAuth.ts`
- next-order:
  - `lib/payperic-essay-manifest.ts` — 교재 → 상품 명세(제목/가격/태그)
  - `lib/essay-pdf-render.ts` — 그룹별 PDF 렌더(공용, bulk-pdf-zip 과 공유)
  - `lib/payperic-client.ts` — presign→PUT→create 클라이언트
  - `app/api/admin/essay-generator/payperic-upload/route.ts` — POST 업로드 / GET 상태
  - `app/admin/essay-generator/EssayGeneratorClient.tsx` — `PaypericUploadBar`

## 수동 테스트

1. 두 앱에 같은 `PAYPERIC_INGEST_SECRET`, next-order 에 `PAYPERIC_INGEST_URL` 설정 후 재기동.
2. payperic 에 S3(`S3_*`/`AWS_*`) + `MONGODB_URI` 정상 설정 확인.
3. 출제기 → 📂 목록 → 모의고사 교재 선택 → 업로드 바에 「미업로드 (0/N)」 확인.
4. 「🛒 업로드」 → 완료 후 「✓ 업로드됨 (N/N)」 + 「생성 …건」 표시.
5. payperic 관리자 상품 목록(또는 `Product` 컬렉션 `tags: "batch:<교재명>"`)에서 상품 확인.
6. 다시 업로드 → 전부 「건너뜀」(멱등) 확인.

> 가격을 배치별로 바꿔야 하면 기존 `payperic/scripts/update-condition-writing-prices.ts`
> (태그 기준 일괄 조정)를 그대로 쓸 수 있다. 적재는 제목 기준 멱등이라 가격 조정과 독립.
