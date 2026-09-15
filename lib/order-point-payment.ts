import {
  isZeroPaymentOrderText,
  parseDepositDueFromOrderText,
  parseOrderRevenueFromOrderText,
} from '@/lib/order-revenue';

/**
 * 주문을 회원 포인트로 결제했을 때 주문서·상태를 맞춘다.
 *
 * 회원이 주문서에서 직접 포인트를 쓰면 주문서가 「포인트 사용: NP / 입금하실 금액: (금액−포인트)원」으로
 * 적히고, 낼 금액이 0원이면 접수 즉시 「입금 확인」이 된다(app/api/orders/route.ts 의 noPaymentRequired).
 *
 * 관리자가 나중에 「포인트 결제」 버튼으로 처리한 주문은 포인트만 깎이고 주문서·상태가 그대로였다.
 * 그래서 ① 「주문 접수」에 머물렀고 ② 목록의 입금액이 전액으로 보였고 ③ 실입금 매출
 * (effectiveOrderNetRevenueWon)이 「입금하실 금액」 줄을 믿어 포인트분을 현금 매출로 한 번 더 셌다
 * (포인트는 충전 때 이미 매출이다). 주문서를 회원이 직접 쓴 것과 같은 모양으로 고치면 셋이 함께 풀린다.
 */

/** 입금 전 단계 — 여기서만 「입금 확인」으로 올린다. 제작 중·완료·취소 등은 건드리지 않는다. */
const PRE_PAYMENT_STATUSES = new Set(['pending', 'accepted']);

/** 포인트를 쓰기 전에 낼 금액 — 「입금하실 금액」 줄, 없으면 주문서 금액. 읽지 못하면 null. */
export function orderAmountDueBeforePoints(orderText: string, orderMeta?: unknown): number | null {
  const declared = parseDepositDueFromOrderText(orderText);
  if (declared != null) return declared;
  if (isZeroPaymentOrderText(orderText)) return 0;
  return parseOrderRevenueFromOrderText(orderText, orderMeta);
}

const won = (n: number): string => n.toLocaleString('ko-KR');

/** 주문서에 이미 적힌 포인트 사용 줄(회원이 주문서에서 쓴 경우) */
export function hasPointUsageLine(orderText: string): boolean {
  return /포인트\s*사용\s*[:：]?\s*[\d,]+\s*P/.test(orderText);
}

/**
 * 주문서에 포인트 사용을 적는다 — 회원 주문서(MockExamSettings 등)와 같은 두 줄.
 * 「입금하실 금액」 줄이 있으면 그 자리를 바꾸고, 없으면 입금 계좌 안내 앞(없으면 끝)에 붙인다.
 */
export function applyPointsToOrderText(
  orderText: string,
  pointsUsed: number,
  dueBefore: number,
): { text: string; dueAfter: number } {
  const dueAfter = Math.max(0, dueBefore - pointsUsed);
  const block = `포인트 사용: ${won(pointsUsed)}P\n입금하실 금액: ${won(dueAfter)}원`;
  const line = /(?:포인트\s*사용\s*[:：]?\s*[\d,]+\s*P[ \t]*\n)?입금하실\s*금액\s*[:：]?\s*[\d,]+\s*원/;
  if (line.test(orderText)) return { text: orderText.replace(line, block), dueAfter };
  const account = orderText.indexOf('[회원 입금 계좌]');
  if (account >= 0) {
    return { text: `${orderText.slice(0, account).trimEnd()}\n\n${block}\n\n${orderText.slice(account)}`, dueAfter };
  }
  return { text: `${orderText.trimEnd()}\n\n${block}`, dueAfter };
}

/** 포인트로 낼 금액이 남지 않았고 아직 입금 전 단계면 「입금 확인」으로 올린다. */
export function shouldConfirmPaymentAfterPoints(status: unknown, dueAfter: number): boolean {
  const s = typeof status === 'string' && status ? status : 'pending';
  return dueAfter === 0 && PRE_PAYMENT_STATUSES.has(s);
}
