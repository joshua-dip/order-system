/**
 * VIP 전역 과목 컨텍스트 (영어/수학/…).
 * - 클라이언트: localStorage 'vipSubject'
 * - 서버: 쿠키 'vip_subject' (school-exams 등 데이터 필터용)
 * 변형문제 자동생성·문제은행은 영어 전용 엔진이므로 ENGLISH_ONLY_MENU_IDS 로 분기.
 */
export const VIP_SUBJECT_KEY = 'vipSubject';
export const VIP_SUBJECT_COOKIE = 'vip_subject';
export const DEFAULT_VIP_SUBJECT = '영어';

/** 변형문제(영어 독해) 전용 메뉴 — 타 과목 선택 시 숨김. */
export const ENGLISH_ONLY_MENU_IDS = new Set(['generate', 'questions']);

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
