import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';

export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { id, undoType, previousStatus } = await request.json();
  if (!id || typeof id !== 'string' || !undoType) {
    return NextResponse.json({ error: 'id, undoType이 필요합니다.' }, { status: 400 });
  }

  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');
  const doc = await col.findOne({ _id: new ObjectId(id) });
  if (!doc) {
    return NextResponse.json({ error: '문제를 찾을 수 없습니다.' }, { status: 404 });
  }

  if (undoType === 'approve') {
    await col.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: { status: previousStatus || '완료' },
        $unset: { pric: '', reviewedAt: '' },
      },
    );
  } else if (undoType === 'reject') {
    await col.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: { status: previousStatus || '완료' },
        $unset: { rejectedAt: '', rejectReason: '' },
      },
    );
  } else {
    return NextResponse.json({ error: '잘못된 undoType' }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
