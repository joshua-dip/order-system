import { NextRequest, NextResponse } from 'next/server';
import {
  createApplication,
  normalizePhone,
  hasRecentApplicationByPhone,
  countRecentApplicationsByIp,
  type MembershipApplicantType,
} from '@/lib/membership-applications-store';
import { getDb } from '@/lib/mongodb';
import { bumpRetryAttempt, findExistingForPhone } from '@/lib/membership-application-duplicates';

const VALID_TYPES: MembershipApplicantType[] = ['student', 'parent', 'teacher'];

function getIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}

export async function POST(request: NextRequest) {
  let body: {
    applicantType?: unknown;
    name?: unknown;
    phone?: unknown;
    privacyConsent?: unknown;
    privacyConsentVersion?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '요청 형식이 올바르지 않습니다.' }, { status: 400 });
  }

  const { applicantType, name, phone } = body;

  // 개인정보 수집·이용 동의 필수 검증 (한국 개인정보보호법 준수)
  if (body.privacyConsent !== true) {
    return NextResponse.json(
      { error: '개인정보 수집·이용에 동의해 주세요.' },
      { status: 400 },
    );
  }
  const privacyConsentVersion =
    typeof body.privacyConsentVersion === 'string' && body.privacyConsentVersion.trim()
      ? body.privacyConsentVersion.trim().slice(0, 64)
      : 'unknown';

  // 유형 검증
  if (!VALID_TYPES.includes(applicantType as MembershipApplicantType)) {
    return NextResponse.json(
      { error: '신청 유형을 선택해주세요. (student / parent / teacher)' },
      { status: 400 },
    );
  }

  // 이름 검증
  const nameStr = String(name ?? '').trim();
  if (nameStr.length < 2 || nameStr.length > 30) {
    return NextResponse.json({ error: '이름을 2~30자로 입력해주세요.' }, { status: 400 });
  }

  // 전화번호 검증 및 정규화
  const normalizedPhone = normalizePhone(String(phone ?? ''));
  if (!normalizedPhone) {
    return NextResponse.json(
      { error: '010으로 시작하는 11자리 전화번호를 입력해주세요.' },
      { status: 400 },
    );
  }

  /* 이미 회원이거나 이미 신청해 처리 중인 번호 — 새 신청서를 만들지 않고 안내한다.
     (예전엔 24시간 안의 중복만 막아서, 하루 넘게 기다린 신청자가 다시 신청하면 관리자 화면에 「신규」로 또 떴다.)
     이미 회원인지 신청 중인지는 일부러 구분해 알려 주지 않는다 — 번호만으로 가입 여부를 캐낼 수 없게. */
  const db = await getDb('gomijoshua');
  const existing = await findExistingForPhone(db, normalizedPhone);
  if (existing.member || existing.openApplicationId) {
    if (existing.openApplicationId) await bumpRetryAttempt(db, existing.openApplicationId);
    return NextResponse.json(
      {
        code: 'already_applied',
        error: '이 번호로는 이미 가입 신청이 접수되었거나 가입이 되어 있어요. 카톡이나 문자로 문의해 주세요.',
      },
      { status: 409 },
    );
  }

  // 중복 신청 차단 (같은 전화, 24h 이내)
  const isDuplicate = await hasRecentApplicationByPhone(normalizedPhone);
  if (isDuplicate) {
    return NextResponse.json(
      { error: '이미 신청하셨습니다. 24시간 이내 동일한 전화번호로 재신청할 수 없습니다.' },
      { status: 400 },
    );
  }

  // IP rate limit (1h 5건)
  const ip = getIp(request);
  if (ip !== 'unknown') {
    const ipCount = await countRecentApplicationsByIp(ip);
    if (ipCount >= 5) {
      return NextResponse.json(
        { error: '일시적으로 신청이 제한되었습니다. 잠시 후 다시 시도해주세요.' },
        { status: 429 },
      );
    }
  }

  const userAgent = request.headers.get('user-agent') ?? undefined;
  const row = await createApplication({
    applicantType: applicantType as MembershipApplicantType,
    name: nameStr,
    phone: normalizedPhone,
    ip,
    userAgent,
    privacyConsent: {
      agreed: true,
      agreedAt: new Date(),
      version: privacyConsentVersion,
    },
  });

  return NextResponse.json({
    ok: true,
    id: row.id,
  });
}
