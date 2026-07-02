/**
 * VIP 전역 과목 컨텍스트 (영어/수학/…).
 * - 클라이언트: localStorage 'vipSubject'
 * - 서버: 쿠키 'vip_subject' (school-exams 등 데이터 필터용)
 * 변형문제 자동생성·문제은행은 영어 전용 엔진이므로 ENGLISH_ONLY_MENU_IDS 로 분기.
 */
export const VIP_SUBJECT_KEY = 'vipSubject';
export const VIP_SUBJECT_COOKIE = 'vip_subject';
export const DEFAULT_VIP_SUBJECT = '영어';

/**
 * 변형문제(영어 독해) 전용 메뉴 — 타 과목 선택 시 숨김.
 * (오답노트 'review' 는 영어=QR 자동 + 국어·수학=수동 하위메뉴로 전 과목 지원하므로 제외)
 */
export const ENGLISH_ONLY_MENU_IDS = new Set(['generate', 'questions', 'qbank-api', 'homework', 'writing', 'class-kit', 'passage-analysis']);

/** 수학 전용 메뉴 — 수학 과목 선택 시에만 노출(다른 과목에선 숨김). */
export const MATH_ONLY_MENU_IDS = new Set(['math-problems']);

/** 과목별 메뉴 노출 여부. 영어전용/수학전용은 해당 과목에서만 보이고, 그 외 메뉴는 전 과목 공통. */
export function isMenuVisibleForSubject(menuId: string, subject: string): boolean {
  if (ENGLISH_ONLY_MENU_IDS.has(menuId)) return subject === DEFAULT_VIP_SUBJECT;
  if (MATH_ONLY_MENU_IDS.has(menuId)) return subject === '수학';
  return true;
}

export function getCurrentSubject(): string {
  if (typeof window === 'undefined') return DEFAULT_VIP_SUBJECT;
  try { return localStorage.getItem(VIP_SUBJECT_KEY) || DEFAULT_VIP_SUBJECT; } catch { return DEFAULT_VIP_SUBJECT; }
}

export function setCurrentSubject(s: string) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(VIP_SUBJECT_KEY, s); } catch { /* ignore */ }
  document.cookie = `${VIP_SUBJECT_COOKIE}=${encodeURIComponent(s)}; path=/; max-age=31536000; samesite=lax`;
}

/** 서버: 요청 쿠키에서 현재 과목 읽기. */
export function subjectFromCookie(cookieValue: string | undefined | null): string {
  const v = (cookieValue ?? '').trim();
  return v || DEFAULT_VIP_SUBJECT;
}

export function isEnglish(subject: string): boolean {
  return subject === DEFAULT_VIP_SUBJECT;
}
