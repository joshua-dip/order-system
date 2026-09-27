/**
 * 공개 무료 PDF(/free) 한도 — 클라이언트에서도 import 할 수 있도록 서버 모듈(mongodb)과 분리.
 * 서버 쪽 `public-free-rate-limit.ts` · `public-free-questions.ts` 가 이 값을 다시 내보낸다.
 */

/** IP 당 하루 다운로드 허용 횟수 */
export const PUBLIC_FREE_DAILY_LIMIT = 5;

/** PDF 한 번에 담을 수 있는 문항 수 상한 */
export const PUBLIC_FREE_MAX_QUESTIONS_PER_PDF = 60;
