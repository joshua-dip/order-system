import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { generateQuestionExplanationWithClaude } from '@/lib/generate-question-explanation-claude';

export const maxDuration = 120;

/**
 * DB 문항을 읽어 Claude로 Explanation 생성 후 question_data.Explanation만 갱신.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { id } = await params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 });
  }

  const rawBody = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const userHint =
    typeof rawBody.userHint === 'string' ? rawBody.userHint.trim().slice(0, 2000) : '';

  try {
    const db = await getDb('gomijoshua');
    const col = db.collection('generated_questions');
    const existing = await col.findOne({ _id: new ObjectId(id) });
    if (!existing) {
      return NextResponse.json({ error: '문서를 찾을 수 없습니다.' }, { status: 404 });
    }

    const qd = existing.question_data;
    if (!qd || typeof qd !== 'object' || Array.isArray(qd)) {
      return NextResponse.json({ error: 'question_data가 없습니다.' }, { status: 400 });
    }

    const type = typeof existing.type === 'string' ? existing.type.trim() : '';

    const result = await generateQuestionExplanationWithClaude({
      questionData: qd as Record<string, unknown>,
      type,
      userHint,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const nextQuestionData = {
      ...(qd as Record<string, unknown>),
      Explanation: result.explanation,
    };

    await col.updateOne(
      { _id: new ObjectId(id) },
      { $set: { question_data: nextQuestionData, updated_at: new Date() } }
    );

    return NextResponse.json({
      ok: true,
      explanation: result.explanation,
    });
  } catch (e) {
    console.error('write-explanation:', e);
    return NextResponse.json({ error: '해설 저장 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
