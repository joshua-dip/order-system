import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { getQuestionCountSnapshotsCollection } from '@/lib/question-count-snapshot-db';

/**
 * 단일 스냅샷 전체(report 포함).
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { id } = await context.params;
  if (!id || !ObjectId.isValid(id)) {
    return NextResponse.json({ error: '유효한 id가 아닙니다.' }, { status: 400 });
  }

  try {
    const col = await getQuestionCountSnapshotsCollection();
    const doc = await col.findOne({ _id: new ObjectId(id) });
    if (!doc) {
      return NextResponse.json({ error: '스냅샷을 찾을 수 없습니다.' }, { status: 404 });
    }

    const saved_at =
      doc.saved_at instanceof Date ? doc.saved_at.toISOString() : doc.saved_at;

    return NextResponse.json({
      ok: true,
      id: String(doc._id),
      saved_at,
      saved_by_login_id: doc.saved_by_login_id ?? null,
      note: doc.note ?? null,
      query: doc.query,
      report: doc.report,
    });
  } catch (e) {
    console.error('question-count snapshot get:', e);
    return NextResponse.json({ error: '조회에 실패했습니다.' }, { status: 500 });
  }
}
