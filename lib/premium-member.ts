import { isAnnualMemberActive } from '@/lib/annual-member';

/**
 * users.monthlyMemberUntil 기준 월구독 유효 여부 (만료일 전까지).
 */
export function isMonthlyMemberActive(until: Date | string | null | undefined): boolean {
  if (until == null) return false;
  const end = until instanceof Date ? until : new Date(until);
  if (Number.isNaN(end.getTime())) return false;
  return Date.now() < end.getTime();
}

/**
 * 파이널 예비 모의고사 등: 연회원 또는 월구독(또는 관리자).
 */
export function isPremiumMember(input: {
  role?: string;
  annualSince: Date | string | null | undefined;
  monthlyUntil: Date | string | null | undefined;
}): boolean {
  if (input.role === 'admin') return true;
  if (isAnnualMemberActive(input.annualSince)) return true;
  if (isMonthlyMemberActive(input.monthlyUntil)) return true;
  return false;
}
