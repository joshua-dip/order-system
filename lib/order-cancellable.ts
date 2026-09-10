/**
 * 회원이 「내정보 > 주문내역」에서 직접 취소할 수 있는 주문인지.
 *
 * 원칙은 **관리자가 수락하기 전까지**다. 그런데 입금하실 금액이 0원인 주문은
 * 기다릴 입금이 없어 접수 즉시 `payment_confirmed` 로 자동 처리된다
 * (`app/api/orders/route.ts` 의 `noPaymentRequired`). 사람이 수락한 것이 아닌데도
 * 상태만 보고 막으면, 무료 문항으로 낸 주문은 회원이 스스로 취소할 수가 없다
 * (2026-09-10 실제로 그래서 관리자가 대신 취소해 줬다).
 *
 * 그래서 **자동 확인 표시(`paymentAutoConfirmed`)가 붙은 건은 열어 준다.**
 * 사람이 입금을 확인한 건에는 이 표시가 없으므로 그대로 막힌다.
 *
 * 취소하면 포인트는 `tryRefundPointsAfterOrderCancelled` 가 돌려주고,
 * 무료 차감 문항은 별도 장부가 없어(주문에서 되센다) 자동으로 복구된다.
 */
export function isMemberCancellableOrder(
  order: Record<string, unknown> | null | undefined,
): boolean {
  if (!order) return false;
  const raw = order.status;
  const status = typeof raw === 'string' && raw ? raw : 'pending';
  if (status === 'pending') return true;
  return status === 'payment_confirmed' && order.paymentAutoConfirmed === true;
}

/**
 * 위 규칙을 그대로 담은 `updateOne` 필터 조건.
 * 상태를 읽은 뒤 바꾸는 사이에 관리자가 손대는 경우를 막으려면 조건부 갱신이어야 한다.
 */
export function memberCancelUpdateFilter(status: string): Record<string, unknown> {
  return status === 'pending'
    ? { status: 'pending' }
    : { status: 'payment_confirmed', paymentAutoConfirmed: true };
}
