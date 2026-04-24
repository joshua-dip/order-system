import { NextRequest, NextResponse } from 'next/server';
import {
  createApplication,
  normalizePhone,
  hasRecentApplicationByPhone,
  countRecentApplicationsByIp,
  type MembershipApplicantType,
} from '@/lib/membership-applications-store';

const VALID_TYPES: MembershipApplicantType[] = ['student', 'parent', 'teacher'];

function getIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}

export async function POST(request: NextRequest) {
  let body: { applicantType?: unknown; name?: unknown; phone?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '요청 형식이 올바르지 않습니다.' }, { status: 400 });
  }

  const { applicantType, name, phone } = body;

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
  });

  return NextResponse.json({
    ok: true,
    id: row.id,
  });
}
