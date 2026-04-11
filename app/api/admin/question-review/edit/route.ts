import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';

export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const body = await request.json();
  const { id, question_data, difficulty, type } = body;

  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 });
  }

  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');

  const doc = await col.findOne({ _id: new ObjectId(id) });
  if (!doc) {
    return NextResponse.json({ error: '문제를 찾을 수 없습니다.' }, { status: 404 });
  }

  const $set: Record<string, unknown> = { updated_at: new Date() };

  if (question_data && typeof question_data === 'object') {
    const allowed = ['Question', 'Paragraph', 'Options', 'CorrectAnswer', 'Explanation'] as const;
    for (const key of allowed) {
      if (typeof question_data[key] === 'string') {
        $set[`question_data.${key}`] = question_data[key];
      }
    }
  }

  if (typeof difficulty === 'string' && ['중', '상'].includes(difficulty)) {
    $set.difficulty = difficulty;
  }

  if (typeof type === 'string' && ['빈칸', '순서', '삽입', '무관한문장', '삽입-고난도', '주제', '어법', '주장', '제목', '일치', '불일치', '함의', '요약'].includes(type)) {
    $set.type = type;
  }

  await col.updateOne({ _id: new ObjectId(id) }, { $set });

  return NextResponse.json({ ok: true });
}
