import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { MEMBER_GENERATED_QUESTIONS_COLLECTION } from '@/lib/member-variant-storage';
import { requirePremiumMemberVariant } from '@/lib/member-variant-premium-auth';

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePremiumMemberVariant(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!id || !ObjectId.isValid(id)) {
    return NextResponse.json({ error: '유효한 id가 필요합니다.' }, { status: 400 });
  }

  try {
    const db = await getDb('gomijoshua');
    const row = await db.collection(MEMBER_GENERATED_QUESTIONS_COLLECTION).findOne(
      { _id: new ObjectId(id), ownerUserId: auth.userId },
      {
        projection: {
          created_at: 1,
          updated_at: 1,
          textbook: 1,
          source: 1,
          type: 1,
          status: 1,
          difficulty: 1,
          passage_id: 1,
          question_data: 1,
        },
      },
    );
    if (!row) {
      return NextResponse.json({ error: '문항을 찾을 수 없습니다.' }, { status: 404 });
    }

    const passage_id =
      row.passage_id && typeof row.passage_id === 'object' && 'toString' in row.passage_id
        ? String(row.passage_id)
        : row.passage_id != null
          ? String(row.passage_id)
          : '';

    return NextResponse.json({
      ok: true,
      id: String(row._id),
      created_at: row.created_at instanceof Date ? row.created_at.toISOString() : null,
      textbook: row.textbook,
      source: row.source,
      type: row.type,
      status: row.status,
      difficulty: row.difficulty,
      passage_id,
      question_data: row.question_data && typeof row.question_data === 'object' ? row.question_data : {},
    });
  } catch (e) {
    console.error('member-variant question detail:', e);
    return NextResponse.json({ error: '불러오지 못했습니다.' }, { status: 500 });
  }
}

/**
 * 회원 본인 문항만: 대기 → 완료(직접·외부 검수 후 확정).
 */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePremiumMemberVariant(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!id || !ObjectId.isValid(id)) {
    return NextResponse.json({ error: '유효한 id가 필요합니다.' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON 본문이 필요합니다.' }, { status: 400 });
  }

  const action = (body as { action?: unknown })?.action;
  if (action !== 'markReviewComplete') {
    return NextResponse.json({ error: '지원하지 않는 작업입니다.' }, { status: 400 });
  }

  try {
    const db = await getDb('gomijoshua');
    const col = db.collection(MEMBER_GENERATED_QUESTIONS_COLLECTION);
    const now = new Date();
    const r = await col.updateOne(
      { _id: new ObjectId(id), ownerUserId: auth.userId, status: '대기' },
      { $set: { status: '완료', updated_at: now } },
    );
    if (r.matchedCount === 0) {
      const exists = await col.findOne(
        { _id: new ObjectId(id), ownerUserId: auth.userId },
        { projection: { status: 1 } },
      );
      if (!exists) {
        return NextResponse.json({ error: '문항을 찾을 수 없습니다.' }, { status: 404 });
      }
      return NextResponse.json(
        { error: '「대기」인 문항만 검수 완료로 바꿀 수 있습니다.' },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true, status: '완료' });
  } catch (e) {
    console.error('member-variant question PATCH:', e);
    return NextResponse.json({ error: '처리하지 못했습니다.' }, { status: 500 });
  }
}
