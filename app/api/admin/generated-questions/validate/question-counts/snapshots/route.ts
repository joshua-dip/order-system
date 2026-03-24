import { NextRequest, NextResponse } from 'next/server';
import { getQuestionCountSnapshotsCollection } from '@/lib/question-count-snapshot-db';
import { requireAdmin } from '@/lib/admin-auth';

/**
 * 저장된 문제수 검증 스냅샷 목록(본문 배열 제외).
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const limit = Math.min(100, Math.max(1, parseInt(request.nextUrl.searchParams.get('limit') || '40', 10) || 40));
  const textbook = request.nextUrl.searchParams.get('textbook')?.trim() || '';

  try {
    const col = await getQuestionCountSnapshotsCollection();
    const filter = textbook ? { 'query.textbook': textbook } : {};
    const rows = await col
      .find(filter)
      .sort({ saved_at: -1 })
      .limit(limit)
      .project({
        saved_at: 1,
        saved_by_login_id: 1,
        note: 1,
        query: 1,
        'report.passageCount': 1,
        'report.noQuestionsTotal': 1,
        'report.underfilledTotal': 1,
        'report.scope': 1,
        'report.typesChecked': 1,
        'report.requiredPerType': 1,
        'report.message': 1,
        'report.order': 1,
      })
      .toArray();

    const items = rows.map((d) => ({
      id: String(d._id),
      saved_at: d.saved_at instanceof Date ? d.saved_at.toISOString() : d.saved_at,
      saved_by_login_id: d.saved_by_login_id ?? null,
      note: d.note ?? null,
      query: d.query,
      summary: d.report ?? null,
    }));

    return NextResponse.json({ ok: true, items, count: items.length });
  } catch (e) {
    console.error('question-count snapshots list:', e);
    return NextResponse.json({ error: '목록 조회에 실패했습니다.' }, { status: 500 });
  }
}
