const SESSION_KEY = 'next-order:variant-generate-notice-session';
/** 값: 사용자가「오늘 보지 않기」를 누른 날의 KST 날짜(YYYY-MM-DD). 그날에는 배너 숨김. */
const HIDE_DAY_KEY = 'next-order:variant-generate-notice-hide-day-kst';

function kstCalendarDateString(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function shouldShowVariantGenerateNotice(): boolean {
  if (typeof window === 'undefined') return true;
  if (sessionStorage.getItem(SESSION_KEY) === '1') return false;
  const hiddenForDay = localStorage.getItem(HIDE_DAY_KEY);
  if (hiddenForDay && hiddenForDay === kstCalendarDateString()) return false;
  return true;
}

export function dismissVariantGenerateNoticeThisSession(): void {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(SESSION_KEY, '1');
}

export function dismissVariantGenerateNoticeForTodayKst(): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(HIDE_DAY_KEY, kstCalendarDateString());
}

export function resetVariantGenerateNoticeDismissals(): void {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(HIDE_DAY_KEY);
}
