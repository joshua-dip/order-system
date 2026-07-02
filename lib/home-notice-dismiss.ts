/**
 * 메인 페이지 공지 모달의 노출/숨김 상태 관리.
 *
 * - 「닫기」: 이번 세션 동안만 숨김 (sessionStorage)
 * - 「오늘 하루 보지 않기」: 누른 날(KST) 동안 숨김 (localStorage)
 * - NOTICE_VERSION 을 바꾸면 저장 키가 달라져 모두에게 다시 노출됨.
 * - audience(게스트/회원)별로 키를 분리한다 → 비로그인 상태에서 닫아도,
 *   로그인하면 「회원」 대상 안내(포인트 충전 등)는 다시 한 번 노출된다.
 */

export const HOME_NOTICE_VERSION = '2026-07-exam-rewards';

export type HomeNoticeAudience = 'member' | 'guest';

function storageKeys(audience: HomeNoticeAudience) {
  return {
    session: `next-order:home-notice-session:${HOME_NOTICE_VERSION}:${audience}`,
    hideDay: `next-order:home-notice-hide-day-kst:${HOME_NOTICE_VERSION}:${audience}`,
  };
}

function kstCalendarDateString(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function shouldShowHomeNotice(audience: HomeNoticeAudience = 'guest'): boolean {
  if (typeof window === 'undefined') return false;
  const { session, hideDay } = storageKeys(audience);
  if (sessionStorage.getItem(session) === '1') return false;
  const hiddenForDay = localStorage.getItem(hideDay);
  if (hiddenForDay && hiddenForDay === kstCalendarDateString()) return false;
  return true;
}

export function dismissHomeNoticeThisSession(audience: HomeNoticeAudience = 'guest'): void {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(storageKeys(audience).session, '1');
}

export function dismissHomeNoticeForTodayKst(audience: HomeNoticeAudience = 'guest'): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(storageKeys(audience).hideDay, kstCalendarDateString());
}
