/**
 * 주문서(orderText)에서 실매출(원) 추출 — 플로우별 문구 패턴.
 * 우선순위: 실입금액 → 최종금액 → 고정 번호 항목(가격/금액) → 총·기본 금액
 */
export function parseOrderRevenueFromOrderText(text: string | null | undefined): number | null {
  if (!text || typeof text !== 'string') return null;
  const t = text.replace(/\r\n/g, '\n');

  const toNum = (s: string): number | null => {
    const n = parseInt(String(s).replace(/,/g, ''), 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  const patterns: RegExp[] = [
    /입금하실\s*금액\s*[:：]?\s*([\d,]+)\s*원/i,
    /최종\s*금액\s*[:：]?\s*([\d,]+)\s*원/,
    /(?:^|\n)5\.\s*가격\s*\n:\s*([\d,]+)\s*원/m,
    /(?:^|\n)4\.\s*금액\s*[:：]?\s*([\d,]+)\s*원/m,
    /총\s*금액\s*[:：]?\s*([\d,]+)\s*원/,
    /기본\s*금액\s*[:：]?\s*([\d,]+)\s*원/,
  ];

  for (const re of patterns) {
    const m = t.match(re);
    if (m?.[1]) {
      const n = toNum(m[1]);
      if (n != null && n > 0) return n;
    }
  }
  return null;
}

/** 주문서에만 있는 「입금하실 금액」(포인트 차감 후 실제 입금액) */
export function parseDepositDueFromOrderText(text: string | null | undefined): number | null {
  if (!text || typeof text !== 'string') return null;
  const t = text.replace(/\r\n/g, '\n');
  const m = t.match(/입금하실\s*금액\s*[:：]?\s*([\d,]+)\s*원/i);
  if (!m?.[1]) return null;
  const n = parseInt(String(m[1]).replace(/,/g, ''), 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** 「총 금액」문구(서술형 등). 포인트 전 주문 합계 표시용 */
export function parseOrderGrossTotalFromOrderText(text: string | null | undefined): number | null {
  if (!text || typeof text !== 'string') return null;
  const t = text.replace(/\r\n/g, '\n');
  const m = t.match(/총\s*금액\s*[:：]?\s*([\d,]+)\s*원/);
  if (!m?.[1]) return null;
  const n = parseInt(String(m[1]).replace(/,/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * 포인트를 쓴 주문: 총액(할인 전)·실입금 추정.
 * - 총액: 주문서 `총 금액` 또는 (파싱된 매출액 + 포인트) 가정
 * - 실입금: `입금하실 금액` 또는 총액−포인트 또는 목록용 revenueWon
 */
export function resolvePointOrderDisplayAmounts(args: {
  orderText: string;
  revenueWon: number | null;
  pointsUsed: number;
}): { grossWon: number | null; paymentDueWon: number | null } {
  const { orderText, revenueWon, pointsUsed } = args;
  if (pointsUsed <= 0) {
    return { grossWon: null, paymentDueWon: revenueWon };
  }
  const deposit = parseDepositDueFromOrderText(orderText);
  const grossFromText = parseOrderGrossTotalFromOrderText(orderText);
  const grossFromSum =
    revenueWon != null && revenueWon >= 0 ? revenueWon + pointsUsed : null;
  const grossWon =
    grossFromText != null && grossFromText >= pointsUsed
      ? grossFromText
      : grossFromSum;

  let paymentDueWon: number | null = deposit;
  if (paymentDueWon == null && grossWon != null) {
    paymentDueWon = Math.max(0, grossWon - pointsUsed);
  }
  if (paymentDueWon == null) {
    paymentDueWon = revenueWon;
  }
  return { grossWon, paymentDueWon };
}

/** 한국 시간 기준 이번 달 1일 00:00 (Date는 해당 순간의 UTC 타임스탬프) */
export function startOfKoreaMonth(ref = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(ref);
  const y = parts.find((p) => p.type === 'year')?.value;
  const mo = parts.find((p) => p.type === 'month')?.value;
  if (!y || !mo) return new Date(ref.getFullYear(), ref.getMonth(), 1);
  return new Date(`${y}-${mo}-01T00:00:00+09:00`);
}

export function effectiveOrderRevenueWon(order: {
  revenueWon?: unknown;
  orderText?: unknown;
}): number {
  const stored = order.revenueWon;
  if (typeof stored === 'number' && Number.isFinite(stored) && stored >= 0) return stored;
  const parsed = parseOrderRevenueFromOrderText(
    typeof order.orderText === 'string' ? order.orderText : ''
  );
  return parsed ?? 0;
}
