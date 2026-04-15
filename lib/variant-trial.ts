/**
 * 변형문제 만들기 체험 기간 (일반회원 가입 후 7일).
 * - 프리미엄 회원(월구독/연회원/관리자)은 체험과 무관하게 항상 사용 가능.
 * - 일반회원은 가입일(createdAt) 기준 TRIAL_DAYS일 내에만 체험 허용.
 */

const TRIAL_DAYS = 7;

export type VariantTrialInfo = {
  eligible: boolean;
  daysLeft: number;
  totalDays: number;
  expired: boolean;
};

export function getVariantTrialInfo(
  createdAt: Date | string | null | undefined,
): VariantTrialInfo {
  const total = TRIAL_DAYS;

  if (createdAt == null) return { eligible: false, daysLeft: 0, totalDays: total, expired: true };

  const created = createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (Number.isNaN(created.getTime())) return { eligible: false, daysLeft: 0, totalDays: total, expired: true };

  const expireAt = new Date(created.getTime() + total * 24 * 60 * 60 * 1000);
  const now = Date.now();
  if (now >= expireAt.getTime()) {
    return { eligible: false, daysLeft: 0, totalDays: total, expired: true };
  }

  const msLeft = expireAt.getTime() - now;
  const daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000));

  return { eligible: true, daysLeft, totalDays: total, expired: false };
}
