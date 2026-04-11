import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';

async function getNextPricNumber(db: ReturnType<Awaited<ReturnType<typeof getDb>>['collection']> extends never ? never : Awaited<ReturnType<typeof getDb>>) {
  const counters = db.collection('counters');
  const result = await counters.findOneAndUpdate(
    { _id: 'pric' as unknown as ObjectId },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' },
  );
  return (result as unknown as { seq: number })?.seq ?? 1;
}

export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const body = await request.json();
  const { id, reviewComment, teacherExplanation } = body;

  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 });
  }

  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');

  const doc = await col.findOne({ _id: new ObjectId(id) });
  if (!doc) {
    return NextResponse.json({ error: '문제를 찾을 수 없습니다.' }, { status: 404 });
  }

  if (doc.pric) {
    return NextResponse.json({
      error: `이미 PRIC 번호가 부여되어 있습니다: ${doc.pric}`,
      pric: doc.pric,
    }, { status: 409 });
  }

  const seq = await getNextPricNumber(db);
  const pric = `PRIC-${String(seq).padStart(4, '0')}`;

  const $set: Record<string, unknown> = {
    pric,
    status: '완료',
    reviewedAt: new Date(),
  };
  if (typeof reviewComment === 'string' && reviewComment.trim()) {
    $set.reviewComment = reviewComment;
  }
  if (typeof teacherExplanation === 'string' && teacherExplanation.trim()) {
    $set.teacherExplanation = teacherExplanation;
  }

  await col.updateOne({ _id: new ObjectId(id) }, { $set });

  return NextResponse.json({ ok: true, pric });
}
