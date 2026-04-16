import { NextRequest, NextResponse } from 'next/server';
import { ObjectId, type Db } from 'mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { isPremiumMember } from '@/lib/premium-member';
import { getVariantTrialInfo } from '@/lib/variant-trial';
import { generateVariantDraftQuestionDataWithClaude } from '@/lib/admin-variant-draft-claude';
import { BOOK_VARIANT_QUESTION_TYPES } from '@/lib/book-variant-types';
import { findOrCreateMemberPassage, getNextMemberQuestionNum } from '@/lib/member-variant-storage';
import {
  VARIANT_HARD_INSERTION_POINT_COST,
  variantTypeRequiresHardInsertionPoints,
} from '@/lib/member-variant-points';
import { recordPointLedger } from '@/lib/point-ledger';

const TYPE_SET = new Set<string>(BOOK_VARIANT_QUESTION_TYPES);

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
  const typePrompt = typeof body.typePrompt === 'string' ? body.typePrompt.trim() : '';

  if (!paragraph || paragraph.length < 10) {
    return NextResponse.json({ error: '지문을 충분히 입력해 주세요.' }, { status: 400 });
  }
  if (!type || !TYPE_SET.has(type)) {
    return NextResponse.json({ error: '유효한 문제 유형이 필요합니다.' }, { status: 400 });
  }

  const ownerId = new ObjectId(payload.sub);
  let hardInsertionDebited = false;
  /** 차감 원장을 DB에 쓴 뒤에만 true — 환불 시 +원장 필요 여부 */
  let hardInsertionSpendLedgerWritten = false;
  let generationCommitted = false;
  let balanceAfterHardDebit = 0;

  const refundHardInsertionPoints = async (db: Db, writeRefundLedger: boolean) => {
    if (!hardInsertionDebited) return;
    try {
      const refundResult = await db.collection('users').findOneAndUpdate(
        { _id: ownerId },
        { $inc: { points: VARIANT_HARD_INSERTION_POINT_COST } },
        { returnDocument: 'after' },
      );
      const newPts = (refundResult?.value as { points?: unknown } | null)?.points;
      if (
        writeRefundLedger &&
        hardInsertionSpendLedgerWritten &&
        typeof newPts === 'number' &&
        Number.isFinite(newPts)
      ) {
        await recordPointLedger(db, {
          userId: ownerId,
          delta: VARIANT_HARD_INSERTION_POINT_COST,
          balanceAfter: newPts,
          kind: 'member_variant_refund',
          meta: { reason: 'draft_generation_failed_or_error' },
        });
      }
    } catch (refundErr) {
      console.error('member-variant generate: 포인트 환불 실패', refundErr);
    }
    hardInsertionDebited = false;
    hardInsertionSpendLedgerWritten = false;
  };

  try {
    const db = await getDb('gomijoshua');
    const usersColl = db.collection('users');
    const user = await usersColl.findOne(
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

    if (variantTypeRequiresHardInsertionPoints(type)) {
      const debitResult = await usersColl.findOneAndUpdate(
        { _id: ownerId, points: { $gte: VARIANT_HARD_INSERTION_POINT_COST } },
        { $inc: { points: -VARIANT_HARD_INSERTION_POINT_COST } },
        { returnDocument: 'after' },
      );
      const afterDoc = debitResult?.value;
      const pts = afterDoc != null ? (afterDoc as { points?: unknown }).points : undefined;
      if (afterDoc == null || typeof pts !== 'number' || !Number.isFinite(pts) || pts < 0) {
        return NextResponse.json(
          {
            error: `삽입-고난도는 1문항당 ${VARIANT_HARD_INSERTION_POINT_COST}포인트가 필요합니다. 포인트를 충전하거나 충분히 보유한 뒤 다시 시도해 주세요.`,
          },
          { status: 402 },
        );
      }
      balanceAfterHardDebit = pts;
      hardInsertionDebited = true;
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
    const nextNum = await getNextMemberQuestionNum({ passage_id, source, type });

    if (hardInsertionDebited) {
      try {
        await recordPointLedger(db, {
          userId: ownerId,
          delta: -VARIANT_HARD_INSERTION_POINT_COST,
          balanceAfter: balanceAfterHardDebit,
          kind: 'member_variant_hard',
          meta: { type: '삽입-고난도', passage_id: String(passage_id) },
        });
        hardInsertionSpendLedgerWritten = true;
      } catch (ledgerErr) {
        console.error('member-variant generate: 차감 원장 기록 실패 — 포인트 환급', ledgerErr);
        await refundHardInsertionPoints(db, false);
        return NextResponse.json(
          { error: '포인트 사용 내역을 저장하지 못했습니다. 차감된 포인트는 되돌려졌습니다. 잠시 후 다시 시도해 주세요.' },
          { status: 503 },
        );
      }
    }

    const ai = await generateVariantDraftQuestionDataWithClaude({
      paragraph,
      type,
      nextNum,
      userHint,
      typePrompt,
      anthropicApiKey: apiKeyHeader,
    });

    if (!ai.ok) {
      await refundHardInsertionPoints(db, true);
      return NextResponse.json({ error: ai.error }, { status: 422 });
    }

    generationCommitted = true;

    return NextResponse.json({
      ok: true,
      passage_id: String(passage_id),
      nextNum,
      textbook,
      source,
      type,
      question_data: ai.question_data,
      ...(hardInsertionDebited ? { points_spent: VARIANT_HARD_INSERTION_POINT_COST } : {}),
    });
  } catch (e) {
    if (hardInsertionDebited && !generationCommitted) {
      try {
        const db = await getDb('gomijoshua');
        await refundHardInsertionPoints(db, true);
      } catch {
        /* ignore */
      }
    }
    console.error('member-variant generate:', e);
    return NextResponse.json({ error: '생성 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
