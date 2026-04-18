import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { isPremiumMember } from '@/lib/premium-member';
import { getVariantTrialInfo } from '@/lib/variant-trial';
import { findOrCreateMemberPassage } from '@/lib/member-variant-storage';
import {
  generateEssayDraftWithClaude,
  isMemberEssayQuestionType,
} from '@/lib/member-essay-draft-claude';

export async function POST(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }
  const payload = await verifyToken(token);
  if (!payload) {
    return NextResponse.json({ error: '인증이 만료되었습니다.' }, { status: 401 });
  }

  const apiKeyHeader = request.headers.get('x-anthropic-api-key')?.trim();
  if (!apiKeyHeader) {
    return NextResponse.json(
      { error: 'Anthropic API 키를 헤더 x-anthropic-api-key 로 보내 주세요.' },
      { status: 400 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON 본문이 필요합니다.' }, { status: 400 });
  }

  const paragraph = typeof body.paragraph === 'string' ? body.paragraph.trim() : '';
  const type = typeof body.type === 'string' ? body.type.trim() : '';
  const textbook = typeof body.textbook === 'string' ? body.textbook.trim() : '회원지문';
  const source = typeof body.source === 'string' ? body.source.trim() : '직접입력';
  const userHint = typeof body.userHint === 'string' ? body.userHint.trim() : '';

  if (!paragraph || paragraph.length < 10) {
    return NextResponse.json({ error: '지문을 충분히 입력해 주세요.' }, { status: 400 });
  }
  if (!type || !isMemberEssayQuestionType(type)) {
    return NextResponse.json(
      { error: '유효한 서술형 문제 유형이 필요합니다. (요약문본문어휘, 요약문조건영작배열)' },
      { status: 400 },
    );
  }

  const ownerId = new ObjectId(payload.sub);

  try {
    const db = await getDb('gomijoshua');
    const user = await db.collection('users').findOne(
      { _id: ownerId },
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
      signupPremiumTrialUntil:
        (user as { signupPremiumTrialUntil?: Date }).signupPremiumTrialUntil ?? null,
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
    const { passage_id } = await findOrCreateMemberPassage({
      ownerUserId: ownerId,
      ownerPhone,
      textbook,
      source,
      paragraph,
    });

    const result = await generateEssayDraftWithClaude({
      paragraph,
      type,
      userHint: userHint || undefined,
      anthropicApiKey: apiKeyHeader,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 422 });
    }

    return NextResponse.json({
      ok: true,
      passage_id: String(passage_id),
      textbook,
      source,
      type,
      question_data: result.question_data,
    });
  } catch (e) {
    console.error('member-variant essay-generate:', e);
    return NextResponse.json({ error: '생성 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
