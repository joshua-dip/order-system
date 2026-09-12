import { type Db } from 'mongodb';
import { hashPassword, DEFAULT_MEMBER_INITIAL_PASSWORD } from '@/lib/auth';
import { SIGNUP_PREMIUM_TRIAL_DAYS } from '@/lib/premium-member';
import { issueCoupon, ensureCouponIndexes, isValidCouponPct } from '@/lib/coupons';
import { getApplication, updateApplicationStatus } from '@/lib/membership-applications-store';

/**
 * 가입 신청서 → 사용자 계정 생성.
 *
 * 「계정 자동 생성」 버튼과 「연락완료」 처리가 **같은 경로**를 쓰도록 뽑아낸 것이다.
 * 예전에는 이 로직이 create-account 라우트 안에만 있어서, 연락완료로 상태가 바뀐 신청서는
 * 관리자 대시보드 목록(`status=pending` 만 조회)에서 사라지고 계정을 만들 방법이 없었다.
 *
 * 성공하면 신청서를 `completed` 로 넘긴다 — 그 시점에 이름·전화가 마스킹되므로
 * **반드시 신청서를 먼저 읽고 계정을 만든 뒤** 상태를 바꾼다.
 */
export type CreateAccountFailure =
  | 'not_found'
  /** 전화번호가 비어 있음 */
  | 'phone_missing'
  /** 이미 마스킹된 신청서(완료·거절 처리분) — 번호가 `010-****-5678` 이라 계정을 만들 수 없다 */
  | 'phone_masked'
  /** 같은 전화번호로 이미 계정이 있음 */
  | 'already_exists';

export type CreateAccountResult =
  | {
      ok: true;
      userId: string;
      loginId: string;
      name: string;
      initialPassword: string;
      couponGrantedPct: number | null;
    }
  | { ok: false; reason: CreateAccountFailure; message: string; loginId?: string };

/** 실패 사유별 HTTP 상태 코드 */
export const CREATE_ACCOUNT_STATUS: Record<CreateAccountFailure, number> = {
  not_found: 404,
  phone_missing: 400,
  phone_masked: 400,
  already_exists: 409,
};

export async function createAccountFromApplication(
  db: Db,
  opts: { applicationId: string; grantCouponPct?: unknown; issuedBy?: string },
): Promise<CreateAccountResult> {
  const app = await getApplication(opts.applicationId);
  if (!app) {
    return { ok: false, reason: 'not_found', message: '신청서를 찾을 수 없습니다.' };
  }

  const phoneDigits = (app.phone || '').replace(/\D/g, '');
  if (!phoneDigits) {
    return { ok: false, reason: 'phone_missing', message: '신청서의 전화번호가 비어 있습니다.' };
  }
  /* 완료·거절 처리분은 개인정보가 마스킹돼 있다(`010-****-5678`). 그대로 숫자만 뽑으면
     7자리가 나와 엉뚱한 loginId 로 계정이 만들어지므로 여기서 막는다. */
  if (app.privacyPurgedAt || phoneDigits.length !== 11) {
    return {
      ok: false,
      reason: 'phone_masked',
      message: '이미 처리된 신청서라 전화번호가 마스킹되어 계정을 만들 수 없습니다. 회원 관리에서 직접 추가해 주세요.',
    };
  }

  const users = db.collection('users');
  const existing = await users.findOne({ loginId: phoneDigits });
  if (existing) {
    return {
      ok: false,
      reason: 'already_exists',
      message: '이미 같은 전화번호로 등록된 계정이 있습니다.',
      loginId: phoneDigits,
    };
  }

  const passwordHash = await hashPassword(DEFAULT_MEMBER_INITIAL_PASSWORD);
  const now = new Date();
  const signupPremiumTrialUntil = new Date(
    now.getTime() + SIGNUP_PREMIUM_TRIAL_DAYS * 24 * 60 * 60 * 1000,
  );

  await users.createIndex({ loginId: 1 }, { unique: true }).catch(() => {});
  const insertResult = await users.insertOne({
    loginId: phoneDigits,
    passwordHash,
    name: app.name || phoneDigits,
    email: '',
    phone: app.phone,
    dropboxFolderPath: '',
    role: 'user',
    canAccessAnalysis: false,
    canAccessEssay: false,
    allowedTextbooks: [],
    allowedTextbooksAnalysis: [],
    allowedTextbooksEssay: [],
    points: 0,
    supplementaryNote: '',
    createdAt: now,
    signupPremiumTrialUntil,
    createdFromApplicationId: opts.applicationId,
  });

  await updateApplicationStatus(opts.applicationId, 'completed').catch(() => {});

  // 가입 환영 — 포인트 충전 할인 쿠폰 지급 (선택)
  const pctRaw = typeof opts.grantCouponPct === 'number' ? opts.grantCouponPct : Number(opts.grantCouponPct);
  let couponGrantedPct: number | null = null;
  if (isValidCouponPct(pctRaw)) {
    try {
      await ensureCouponIndexes(db);
      await issueCoupon(db, {
        userId: insertResult.insertedId,
        discountPct: pctRaw,
        issuedBy: opts.issuedBy ?? 'admin',
        note: '가입 환영 쿠폰',
      });
      couponGrantedPct = pctRaw;
    } catch (e) {
      console.error('[create-account] 쿠폰 지급 실패', e);
    }
  }

  return {
    ok: true,
    userId: String(insertResult.insertedId),
    loginId: phoneDigits,
    name: app.name || phoneDigits,
    initialPassword: DEFAULT_MEMBER_INITIAL_PASSWORD,
    couponGrantedPct,
  };
}
