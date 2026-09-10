import { isFreeVariantType, isAdvancedVariantType } from './variant-pricing';

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

/** 유료 멤버십(월·연회원) 1인당 월 무료 기본난도 문항 수 */
export const MEMBER_BASE_FREE_QUOTA = 1000;

/**
 * 가입 체험(7일) 중인 계정의 한도 — 결제 없이 쓰는 기간이라 낮게 잡는다.
 * 체험만 받고 대량으로 뽑아 가는 것을 막기 위함이다.
 */
export const TRIAL_BASE_FREE_QUOTA = 300;

/** 결제 여부에 따른 월 한도. 체험만 유효하면 체험 한도를 준다. */
export function baseFreeQuotaFor(input: { paidMember: boolean }): number {
  return input.paidMember ? MEMBER_BASE_FREE_QUOTA : TRIAL_BASE_FREE_QUOTA;
}

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

/**
 * 주문 하나가 쓴 「유료 기본난도」 문항 수. 원래 무료인 7유형·고난도는 세지 않는다.
 *
 * 지문 수는 flow 마다 다른 필드에 있다 — 부교재(BV)는 `selectedLessons`,
 * 모의고사(MV)는 `examSelections[].numbers` 다. 예전엔 `selectedLessons` 만 봐서
 * MV 주문이 지문 수만큼 통째로 빠졌고(한 회원 24 vs 실제 432), 한도가 사실상
 * 무제한처럼 동작했다. `numbers` 의 "41~42번" 은 지문 하나이므로 배열 길이를 쓴다.
 *
 * 실제로 만들지 못해 못 보낸 문항은 한도에서 빼지 않는다 — 제작기가 발송 직후
 * 남기는 `orders.delivery` 를 읽어 그만큼 줄인다. 유형별 내역(`shortfallByType`)이
 * 있으면 유료 기본난도 부족분만 정확히 빼고, 총량(`shortfall`)만 있으면 그대로 뺀다
 * (무료 유형 부족까지 돌려주게 되지만 고객에게 불리하지 않은 쪽이다).
 *
 * 회원 화면(잔량)과 관리자 화면이 같은 수를 보여야 하므로 여기 한 곳에 둔다.
 */
export function paidBaseCountOfOrder(
  meta: Record<string, unknown> | null | undefined,
  delivery?: Record<string, unknown> | null,
): number {
  if (!meta) return 0;
  const types = Array.isArray(meta.selectedTypes)
    ? (meta.selectedTypes as unknown[]).filter((t): t is string => typeof t === 'string')
    : [];
  const lessons = Array.isArray(meta.selectedLessons) ? (meta.selectedLessons as unknown[]).length : 0;
  const examNumbers = Array.isArray(meta.examSelections)
    ? (meta.examSelections as unknown[]).reduce((sum: number, e) => {
        const nums = (e as { numbers?: unknown })?.numbers;
        return sum + (Array.isArray(nums) ? nums.length : 0);
      }, 0)
    : 0;
  const per = meta.questionsPerType;
  const mult = Math.max(1, lessons || examNumbers);
  let n = 0;
  for (const t of types) {
    if (isFreeVariantType(t) || isAdvancedVariantType(t)) continue;
    const raw =
      typeof per === 'number'
        ? per
        : per && typeof per === 'object'
          ? Number((per as Record<string, unknown>)[t])
          : 1;
    n += (Number.isFinite(raw) && raw > 0 ? raw : 1) * mult;
  }
  if (n <= 0) return 0;

  if (delivery && typeof delivery === 'object') {
    const byType = (delivery as { shortfallByType?: unknown }).shortfallByType;
    if (byType && typeof byType === 'object' && !Array.isArray(byType)) {
      let short = 0;
      for (const [t, v] of Object.entries(byType as Record<string, unknown>)) {
        if (isFreeVariantType(t) || isAdvancedVariantType(t)) continue;
        const c = Number(v);
        if (Number.isFinite(c) && c > 0) short += Math.floor(c);
      }
      return Math.max(0, n - short);
    }
    const total = Number((delivery as { shortfall?: unknown }).shortfall);
    if (Number.isFinite(total) && total > 0) return Math.max(0, n - Math.floor(total));
  }
  return n;
}
