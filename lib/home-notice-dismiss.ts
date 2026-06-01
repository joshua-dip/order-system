/**
 * 메인 페이지 공지 모달의 노출/숨김 상태 관리.
 *
 * - 「닫기」: 이번 세션 동안만 숨김 (sessionStorage)
 * - 「오늘 하루 보지 않기」: 누른 날(KST) 동안 숨김 (localStorage)
 * - NOTICE_VERSION 을 바꾸면 저장 키가 달라져 모두에게 다시 노출됨.
 */

export const HOME_NOTICE_VERSION = '2026-06-variant-discount';

const SESSION_KEY = `next-order:home-notice-session:${HOME_NOTICE_VERSION}`;
const HIDE_DAY_KEY = `next-order:home-notice-hide-day-kst:${HOME_NOTICE_VERSION}`;

function kstCalendarDateString(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function shouldShowHomeNotice(): boolean {
  if (typeof window === 'undefined') return false;
  if (sessionStorage.getItem(SESSION_KEY) === '1') return false;
  const hiddenForDay = localStorage.getItem(HIDE_DAY_KEY);
  if (hiddenForDay && hiddenForDay === kstCalendarDateString()) return false;
  return true;
}

export function dismissHomeNoticeThisSession(): void {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(SESSION_KEY, '1');
}

export function dismissHomeNoticeForTodayKst(): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(HIDE_DAY_KEY, kstCalendarDateString());
}
