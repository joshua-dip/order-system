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
 *
 * 쏠북 연계 BV는 「이곳 입금」이 0원(커스텀 면제)이어도 변형 제작비는 쏠북에서 내도록 안내한다.
 * 일부 회원은 그 변형 제작비를 고미조슈아 포인트로 대신 내길 원하므로, 입금 0원이어도
 * 주문서·orderMeta 의 변형 제작비를 포인트로 처리할 수 있게 한다.
 */

/** 입금 전 단계 — 여기서만 「입금 확인」으로 올린다. 제작 중·완료·취소 등은 건드리지 않는다. */
const PRE_PAYMENT_STATUSES = new Set(['pending', 'accepted']);

type Meta = Record<string, unknown>;

function asMeta(orderMeta: unknown): Meta | null {
  return orderMeta && typeof orderMeta === 'object' && !Array.isArray(orderMeta)
    ? (orderMeta as Meta)
    : null;
}

function solbookMeta(orderMeta: unknown): Meta | null {
  const m = asMeta(orderMeta);
  const sb = m?.solbook;
  return sb && typeof sb === 'object' && !Array.isArray(sb) ? (sb as Meta) : null;
}

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
  return /포인트\s*사용(?:\s*\([^)]*\))?\s*[:：]?\s*[\d,]+\s*P/.test(orderText);
}

/**
 * 쏠북 연계 주문의 변형 제작비(원).
 * orderMeta.solbook.variantFeeWon 우선, 없으면 주문서 「변형 제작 N원」 파싱.
 */
export function parseSolbookVariantProductionFeeWon(
  orderText: string,
  orderMeta?: unknown,
): number | null {
  const sb = solbookMeta(orderMeta);
  if (sb) {
    const fromMeta = sb.variantFeeWon;
    if (typeof fromMeta === 'number' && Number.isFinite(fromMeta) && fromMeta > 0) {
      return Math.floor(fromMeta);
    }
  }
  const patterns = [
    /변형\s*제작\s*([\d,]+)\s*원/,
    /변형\s*문항\s*제작\s*합계\s*[：(]?\s*([\d,]+)\s*원/,
    /변형\s*제작비[^\d\n]{0,12}([\d,]+)\s*원/,
  ];
  for (const re of patterns) {
    const m = orderText.match(re);
    if (!m) continue;
    const n = parseInt(m[1].replace(/,/g, ''), 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/** 이미 포인트로 낸 쏠북 변형 제작비 */
export function solbookVariantPointsAlreadyUsed(orderMeta?: unknown): number {
  const sb = solbookMeta(orderMeta);
  const fromMeta = sb?.variantPointsUsed;
  if (typeof fromMeta === 'number' && Number.isFinite(fromMeta) && fromMeta > 0) {
    return Math.floor(fromMeta);
  }
  return 0;
}

export type OrderPointsPayable =
  | { kind: 'deposit'; amount: number }
  | { kind: 'solbook_variant'; amount: number; variantFeeWon: number };

/**
 * 포인트로 낼 수 있는 금액.
 * 1) 이곳 입금(커스텀·일반 주문) 잔액
 * 2) 입금이 0원인 쏠북 주문의 변형 제작비 잔액
 */
export function resolveOrderPointsPayable(
  orderText: string,
  orderMeta?: unknown,
  pointsUsedOnOrder = 0,
): OrderPointsPayable | null {
  if (pointsUsedOnOrder > 0) return null;

  const deposit = orderAmountDueBeforePoints(orderText, orderMeta);
  if (deposit != null && deposit > 0) {
    return { kind: 'deposit', amount: deposit };
  }

  const sb = solbookMeta(orderMeta);
  const isSolbook = !!sb || /쏠북\s*연계|쏠북\s*결제|쏠북\s*교재/.test(orderText);
  if (!isSolbook) return null;

  const variantFee = parseSolbookVariantProductionFeeWon(orderText, orderMeta);
  if (variantFee == null || variantFee <= 0) return null;

  const already = solbookVariantPointsAlreadyUsed(orderMeta);
  const remain = Math.max(0, variantFee - already);
  if (remain <= 0) return null;

  return { kind: 'solbook_variant', amount: remain, variantFeeWon: variantFee };
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

/**
 * 쏠북 변형 제작비를 포인트로 냈을 때 주문서 문구를 맞춘다.
 * 입금하실 금액(커스텀)은 건드리지 않고, 변형 제작·포인트 안내만 고친다.
 */
export function applySolbookVariantPointsToOrderText(
  orderText: string,
  pointsUsed: number,
  variantFeeWon: number,
): string {
  const remain = Math.max(0, variantFeeWon - pointsUsed);
  const pointLine =
    remain === 0
      ? `포인트 사용(변형 제작비): ${won(pointsUsed)}P — 변형 제작비는 포인트로 결제 완료. 쏠북에서는 교재 본체만 결제해 주세요.`
      : `포인트 사용(변형 제작비): ${won(pointsUsed)}P — 쏠북 변형 제작 잔액 ${won(remain)}원 + 교재 본체`;

  let text = orderText;
  const existingPoint = /포인트\s*사용(?:\s*\([^)]*\))?\s*[:：]?\s*[\d,]+\s*P[^\n]*/;
  if (existingPoint.test(text)) {
    text = text.replace(existingPoint, pointLine);
  } else {
    const account = text.indexOf('[회원 입금 계좌]');
    if (account >= 0) {
      text = `${text.slice(0, account).trimEnd()}\n\n${pointLine}\n\n${text.slice(account)}`;
    } else {
      text = `${text.trimEnd()}\n\n${pointLine}`;
    }
  }

  text = text.replace(
    /※\s*쏠북\s*연계\s*교재:[^\n]*/,
    remain === 0
      ? '※ 쏠북 연계 교재: 변형 제작비는 포인트로 결제되었습니다. 교재 본체만 쏠북에서 결제해 주세요.'
      : `※ 쏠북 연계 교재: 변형 제작비 중 ${won(pointsUsed)}원은 포인트, 잔액 ${won(remain)}원과 교재 본체는 쏠북에서 결제해 주세요.`,
  );

  if (remain === 0) {
    text = text.replace(
      /변형\s*문항\s*제작\s*합계\([^)]*원\)와\s*교재\s*본체\s*대금은\s*쏠북에서\s*결제해\s*주세요\./,
      `변형 문항 제작 합계(${won(variantFeeWon)}원)는 포인트로 결제 완료되었습니다. 교재 본체 대금만 쏠북에서 결제해 주세요.`,
    );
  }

  return text;
}

/** orderMeta.solbook 에 변형 제작 포인트 결제를 반영한 새 meta */
export function withSolbookVariantPointsMeta(
  orderMeta: unknown,
  pointsUsed: number,
  variantFeeWon: number,
): Meta {
  const base = asMeta(orderMeta) ? { ...asMeta(orderMeta)! } : {};
  const prevSb = solbookMeta(orderMeta) ? { ...solbookMeta(orderMeta)! } : {};
  base.solbook = {
    ...prevSb,
    variantFeeWon,
    variantPointsUsed: pointsUsed,
    pointsDisabled: false,
  };
  return base;
}

/** 포인트로 낼 금액이 남지 않았고 아직 입금 전 단계면 「입금 확인」으로 올린다. */
export function shouldConfirmPaymentAfterPoints(status: unknown, dueAfter: number): boolean {
  const s = typeof status === 'string' && status ? status : 'pending';
  return dueAfter === 0 && PRE_PAYMENT_STATUSES.has(s);
}
