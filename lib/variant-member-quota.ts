/**
 * 멤버십 회원의 기본난도 무료 한도.
 *
 * 월회원·연회원은 기본난도 변형문제를 매달 일정 수까지 무료로 받는다.
 * 매출은 고난도(80원)에서 낸다는 방침(2026-09-03).
 *
 * 「전면 무료」가 아니라 한도를 두는 이유 — 실측(주문 135건)상 유료 기본난도가
 * 전체 매출의 79.7% 이고, 한 회원이 한 달에 최대 2,316문항까지 쓴다.
 * 무제한으로 열면 대량 주문 고객이 월 8,900원으로 갈아타 매출이 통째로 사라진다.
 */

/** 멤버십 회원 1인당 월 무료 기본난도 문항 수 */
export const MEMBER_BASE_FREE_QUOTA = 1000;

export interface BaseQuotaSplit {
  /** 한도 안에서 무료로 처리된 문항 수 */
  freeCount: number;
  /** 한도를 넘어 정상가로 계산할 문항 수 */
  paidCount: number;
}

/**
 * 이번 주문의 기본난도 문항을 무료분/유료분으로 가른다.
 *
 * @param count     이번 주문의 유료 기본난도 문항 수 (원래 무료인 7유형은 제외하고 넘긴다)
 * @param remaining 이 회원의 이번 달 남은 무료 한도. 회원이 아니면 0.
 */
export function splitByBaseQuota(count: number, remaining: number): BaseQuotaSplit {
  const usable = Math.max(0, Math.min(count, Math.floor(remaining)));
  return { freeCount: usable, paidCount: Math.max(0, count - usable) };
}

/** KST 기준 이번 달의 시작·끝 (한도는 달마다 초기화된다) */
export function kstMonthRange(now: Date = new Date()): { start: Date; end: Date } {
  const kst = new Date(now.getTime() + 9 * 3600_000);
  const y = kst.getUTCFullYear();
  const m = kst.getUTCMonth();
  /* UTC 로 만든 뒤 9시간 당기면 KST 그 달 1일 00:00 이 된다. */
  const start = new Date(Date.UTC(y, m, 1) - 9 * 3600_000);
  const end = new Date(Date.UTC(y, m + 1, 1) - 9 * 3600_000);
  return { start, end };
}
