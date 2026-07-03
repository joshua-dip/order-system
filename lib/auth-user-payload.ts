import { isAnnualMemberActive } from '@/lib/annual-member';
import { isMonthlyMemberActive, isPremiumMember, isSignupPremiumTrialActive } from '@/lib/premium-member';
import { getVariantTrialInfo } from '@/lib/variant-trial';

/**
 * /api/auth/me 가 내려주는 user 페이로드 빌더 — 로그인 응답에도 동일 형태를 실어
 * 로그인 직후 마이페이지가 auth/me 왕복 없이 즉시 렌더되게 한다(세션 캐시 프라임).
 */
export function buildAuthUserPayload(
  user: Record<string, unknown>,
  mustChangePassword: boolean,
): Record<string, unknown> {
  const points = typeof user.points === 'number' && user.points >= 0 ? user.points : 0;
  const wb = user.allowedTextbooksWorkbook;
  const vb = user.allowedTextbooksVariant;
  const iso = (v: unknown): string | null =>
    v instanceof Date && !Number.isNaN(v.getTime()) ? v.toISOString() : null;

  const annualSince = user.annualMemberSince as Date | undefined;
  const monthlyUntil = user.monthlyMemberUntil as Date | undefined;
  const signupTrialUntil = user.signupPremiumTrialUntil as Date | undefined;
  const premium = isPremiumMember({
    role: typeof user.role === 'string' ? user.role : undefined,
    annualSince: annualSince ?? null,
    monthlyUntil: monthlyUntil ?? null,
    signupPremiumTrialUntil: signupTrialUntil ?? null,
  });
  const phoneRaw = user.phone;
  const allowed = Array.isArray(user.allowedTextbooks) ? user.allowedTextbooks : [];

  return {
    loginId: user.loginId,
    role: user.role,
    name: (user.name as string | undefined) ?? user.loginId,
    email: (user.email as string | undefined) ?? '',
    dropboxFolderPath: (user.dropboxFolderPath as string | undefined) ?? '',
    dropboxSharedLink: (user.dropboxSharedLink as string | undefined) ?? '',
    canAccessAnalysis: !!user.canAccessAnalysis,
    canAccessEssay: !!user.canAccessEssay,
    canOrderSchoolTextbook: !!user.canOrderSchoolTextbook,
    myFormatApproved: !!user.myFormatApproved,
    allowedTextbooks: allowed,
    allowedTextbooksAnalysis: Array.isArray(user.allowedTextbooksAnalysis) ? user.allowedTextbooksAnalysis : allowed,
    allowedTextbooksEssay: Array.isArray(user.allowedTextbooksEssay) ? user.allowedTextbooksEssay : allowed,
    ...(Array.isArray(wb) ? { allowedTextbooksWorkbook: wb } : {}),
    ...(Array.isArray(vb) ? { allowedTextbooksVariant: vb } : {}),
    points,
    annualMemberSince: iso(annualSince),
    isAnnualMemberActive: isAnnualMemberActive(annualSince ?? null),
    monthlyMemberSince: iso(user.monthlyMemberSince),
    monthlyMemberUntil: iso(monthlyUntil),
    isMonthlyMemberActive: isMonthlyMemberActive(monthlyUntil ?? null),
    isPremiumMember: premium,
    signupPremiumTrialUntil: iso(signupTrialUntil),
    signupPremiumTrialActive: isSignupPremiumTrialActive(signupTrialUntil ?? null),
    phone: typeof phoneRaw === 'string' ? phoneRaw.trim() : '',
    isVip: !!user.isVip,
    vipSince: iso(user.vipSince),
    mustChangePassword,
    variantTrial: premium ? null : getVariantTrialInfo((user.createdAt as Date | undefined) ?? null),
  };
}
