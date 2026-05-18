import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/admin/essay-generator/passage-priority
 * body: { passageId: string, priority: number }
 * passages.essayPriority 를 갱신한다. 0 이하면 필드 제거.
 */
export async function PATCH(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  let body: { passageId?: string; priority?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 });
  }

  const passageId = (body.passageId ?? '').trim();
  if (!passageId || !ObjectId.isValid(passageId)) {
    return NextResponse.json({ error: 'passageId(ObjectId)가 필요합니다.' }, { status: 400 });
  }

  const priority = Math.floor(Number(body.priority ?? 0));
  if (!Number.isFinite(priority)) {
    return NextResponse.json({ error: 'priority가 숫자여야 합니다.' }, { status: 400 });
  }

  try {
    const db = await getDb('gomijoshua');
    const update = priority > 0
      ? { $set: { essayPriority: priority } }
      : { $unset: { essayPriority: '' } };
    const result = await db
      .collection('passages')
      .updateOne({ _id: new ObjectId(passageId) }, update);
    if (result.matchedCount === 0) {
      return NextResponse.json({ error: '지문을 찾을 수 없습니다.' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, passageId, priority: priority > 0 ? priority : 0 });
  } catch (e) {
    console.error('[essay-generator passage-priority]', e);
    return NextResponse.json({ error: '저장 실패' }, { status: 500 });
  }
}
