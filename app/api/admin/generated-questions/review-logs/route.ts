import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/lib/mongodb';
import {
  GENERATED_QUESTION_CLAUDE_REVIEWS_COL,
  serializeReviewLog,
} from '@/lib/generated-question-review-log';

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { searchParams } = request.nextUrl;
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '25', 10) || 25));
  const skip = (page - 1) * limit;
  const gqId = searchParams.get('generated_question_id')?.trim() || '';
  const textbook = searchParams.get('textbook')?.trim() || '';
  const mismatchOnly = searchParams.get('mismatch_only') === '1';

  const filter: Record<string, unknown> = {};
  if (gqId && ObjectId.isValid(gqId)) {
    filter.generated_question_id = new ObjectId(gqId);
  }
  if (textbook) filter.textbook = textbook;
  if (mismatchOnly) {
    filter.is_correct = false;
    filter.error = null;
  }

  try {
    const db = await getDb('gomijoshua');
    const col = db.collection(GENERATED_QUESTION_CLAUDE_REVIEWS_COL);
    const [total, rows] = await Promise.all([
      col.countDocuments(filter),
      col
        .find(filter)
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
    ]);

    return NextResponse.json({
      items: rows.map((d) => serializeReviewLog(d as Record<string, unknown>)),
      total,
      page,
      limit,
    });
  } catch (e) {
    console.error('review-logs GET:', e);
    return NextResponse.json({ error: '로그 조회에 실패했습니다.' }, { status: 500 });
  }
}
