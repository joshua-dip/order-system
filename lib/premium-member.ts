import { isAnnualMemberActive } from '@/lib/annual-member';

/** 관리자 회원 생성 시 부여하는 월·연 회원 기능 무료 체험 기간(일) */
export const SIGNUP_PREMIUM_TRIAL_DAYS = 7;

/**
 * 관리자가 생성한 계정 등에 설정된 `signupPremiumTrialUntil` 이전이면
 * 월·연 프리미엄 기능(변형문제 만들기 등)을 쓸 수 있습니다.
 */
export function isSignupPremiumTrialActive(until: Date | string | null | undefined): boolean {
  if (until == null) return false;
  const end = until instanceof Date ? until : new Date(until);
  if (Number.isNaN(end.getTime())) return false;
  return Date.now() < end.getTime();
}

/**
 * 단어장·연회원 무료공유자료 등 「연회원 메뉴」: 유효 연회원이거나 위 체험 기간 중.
 */
export function hasAnnualMemberMenuAccess(input: {
  annualSince: Date | string | null | undefined;
  signupPremiumTrialUntil: Date | string | null | undefined;
}): boolean {
  return isAnnualMemberActive(input.annualSince) || isSignupPremiumTrialActive(input.signupPremiumTrialUntil);
}

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
  signupPremiumTrialUntil?: Date | string | null | undefined;
}): boolean {
  if (input.role === 'admin') return true;
  if (isSignupPremiumTrialActive(input.signupPremiumTrialUntil)) return true;
  if (isAnnualMemberActive(input.annualSince)) return true;
  if (isMonthlyMemberActive(input.monthlyUntil)) return true;
  return false;
}
