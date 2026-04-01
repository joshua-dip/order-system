import { koreaYearMonthKey } from '@/lib/korea-date-key';

/**
 * 주문번호 `MV-20260328-001` 형태에서 중간 YYYYMMDD 추출·검증.
 * 접두 2글자(영문) - 8자리 날짜 - 일련번호.
 */
export function parseOrderNumberYmd(orderNumber: unknown): { y: number; m: number; d: number } | null {
  if (typeof orderNumber !== 'string') return null;
  const s = orderNumber.trim();
  const m = s.match(/^([A-Za-z]{2})-(\d{4})(\d{2})(\d{2})-(\d+)$/);
  if (!m) return null;
  const y = parseInt(m[2], 10);
  const mo = parseInt(m[3], 10);
  const d = parseInt(m[4], 10);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return { y, m: mo, d };
}

/** 주문번호에서 YYYY-MM (달력 그대로, 타임존 보정 없음) */
export function yearMonthFromOrderNumber(orderNumber: unknown): string | null {
  const p = parseOrderNumberYmd(orderNumber);
  if (!p) return null;
  return `${p.y}-${String(p.m).padStart(2, '0')}`;
}

/**
 * 완료 주문 매출을 어느 월에 넣을지(YYYY-MM).
 * 1) 주문번호 중간 연월일(접수일과 동일하게 부여됨)
 * 2) 없거나 형식 불일치 시 completedAt의 한국 연·월
 */
export function revenueMonthKeyForOrder(order: {
  orderNumber?: unknown;
  completedAt?: unknown;
}): string | null {
  const fromNum = yearMonthFromOrderNumber(order.orderNumber);
  if (fromNum) return fromNum;
  const ca = order.completedAt as Date | string | null | undefined;
  if (ca == null) return null;
  const ref = ca instanceof Date ? ca : new Date(ca);
  if (Number.isNaN(ref.getTime())) return null;
  return koreaYearMonthKey(ref);
}
