import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/essay-generator/exams/reorder
 * body: { orderedIds: string[] }
 *
 * 받은 순서대로 essay_exams 의 `order` 필드를 0, 1, 2, ... 로 재할당.
 * (sourceKey 그룹 단위 드래그앤드랍 순서 변경에 사용)
 */
export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  let body: { orderedIds?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 });
  }

  const ids = Array.isArray(body.orderedIds) ? body.orderedIds : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: 'orderedIds 가 비어 있습니다.' }, { status: 400 });
  }

  for (const id of ids) {
    if (typeof id !== 'string' || !ObjectId.isValid(id)) {
      return NextResponse.json({ error: `잘못된 id: ${id}` }, { status: 400 });
    }
  }

  try {
    const db = await getDb('gomijoshua');
    const ops = ids.map((id, idx) => ({
      updateOne: {
        filter: { _id: new ObjectId(id) },
        update: { $set: { order: idx, updatedAt: new Date() } },
      },
    }));
    const r = await db.collection('essay_exams').bulkWrite(ops, { ordered: false });
    return NextResponse.json({ ok: true, matched: r.matchedCount, modified: r.modifiedCount });
  } catch (e) {
    console.error('[essay-generator exams reorder]', e);
    return NextResponse.json({ error: '재정렬 실패' }, { status: 500 });
  }
}
