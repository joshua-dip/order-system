import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';

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

  const $set: Record<string, unknown> = { commentUpdatedAt: new Date() };

  if (typeof reviewComment === 'string') {
    $set.reviewComment = reviewComment;
  }
  if (typeof teacherExplanation === 'string') {
    $set.teacherExplanation = teacherExplanation;
  }

  await col.updateOne({ _id: new ObjectId(id) }, { $set });

  return NextResponse.json({ ok: true });
}
