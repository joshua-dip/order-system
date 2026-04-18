import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { isPremiumMember } from '@/lib/premium-member';
import { getVariantTrialInfo } from '@/lib/variant-trial';
import { assertMemberOwnsPassage, insertMemberGeneratedQuestion } from '@/lib/member-variant-storage';

export async function POST(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }
  const payload = await verifyToken(token);
  if (!payload) {
    return NextResponse.json({ error: '인증이 만료되었습니다.' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON 본문이 필요합니다.' }, { status: 400 });
  }

  const passageIdStr = typeof body.passage_id === 'string' ? body.passage_id.trim() : '';
  const textbook = typeof body.textbook === 'string' ? body.textbook.trim() : '';
  const source = typeof body.source === 'string' ? body.source.trim() : '';
  const type = typeof body.type === 'string' ? body.type.trim() : '';
  const question_data = body.question_data;
  const status = typeof body.status === 'string' ? body.status.trim() : '대기';

  if (!passageIdStr || !ObjectId.isValid(passageIdStr)) {
    return NextResponse.json({ error: '유효한 passage_id가 필요합니다.' }, { status: 400 });
  }
  if (!question_data || typeof question_data !== 'object' || Array.isArray(question_data)) {
    return NextResponse.json({ error: 'question_data 객체가 필요합니다.' }, { status: 400 });
  }

  try {
    const db = await getDb('gomijoshua');
    const user = await db.collection('users').findOne(
      { _id: new ObjectId(payload.sub) },
      {
        projection: {
          role: 1,
          annualMemberSince: 1,
          monthlyMemberUntil: 1,
          signupPremiumTrialUntil: 1,
          phone: 1,
          createdAt: 1,
        },
      },
    );
    if (!user) {
      return NextResponse.json({ error: '사용자를 찾을 수 없습니다.' }, { status: 404 });
    }
    const premium = isPremiumMember({
      role: user.role,
      annualSince: (user as { annualMemberSince?: Date }).annualMemberSince ?? null,
      monthlyUntil: (user as { monthlyMemberUntil?: Date }).monthlyMemberUntil ?? null,
      signupPremiumTrialUntil: (user as { signupPremiumTrialUntil?: Date }).signupPremiumTrialUntil ?? null,
    });
    if (!premium) {
      const trial = getVariantTrialInfo((user as { createdAt?: Date }).createdAt ?? null);
      if (!trial.eligible) {
        return NextResponse.json(
          { error: '체험 기간이 만료되었습니다. 월구독 또는 연회원으로 이용해 주세요.' },
          { status: 403 },
        );
      }
    }

    const phoneRaw = (user as { phone?: string }).phone;
    const ownerPhone = typeof phoneRaw === 'string' ? phoneRaw.trim() : '';

    const ownerId = new ObjectId(payload.sub);
    const passage_id = new ObjectId(passageIdStr);
    const owns = await assertMemberOwnsPassage(ownerId, passage_id);
    if (!owns) {
      return NextResponse.json({ error: '해당 지문에 대한 권한이 없습니다.' }, { status: 403 });
    }

    const result = await insertMemberGeneratedQuestion({
      ownerUserId: ownerId,
      ownerPhone,
      passage_id,
      textbook: textbook || '회원지문',
      source: source || '직접입력',
      type,
      question_data: question_data as Record<string, unknown>,
      status: status || '대기',
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      inserted_id: result.inserted_id,
    });
  } catch (e) {
    console.error('member-variant save:', e);
    return NextResponse.json({ error: '저장 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
