import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { STUDY_PROGRESS_COLLECTION, parseScopeRef, studyActivity } from '@/lib/study-plan';
import { studyPlanMember } from '../_auth';

export const dynamic = 'force-dynamic';

/** PUT { scope, passageId, itemKey, done } — 지문 하나의 활동 하나 체크/해제 */
export async function PUT(request: NextRequest) {
  const me = await studyPlanMember(request);
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const b = (await request.json().catch(() => ({}))) as { scope?: string; passageId?: string; itemKey?: string; done?: boolean };
  const ref = parseScopeRef(b.scope);
  const itemKey = String(b.itemKey ?? '');
  if (!ref || !b.passageId || !ObjectId.isValid(b.passageId) || !studyActivity(itemKey)) {
    return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 });
  }
  const db = await getDb('gomijoshua');
  const scopeKey = `${ref.kind}:${ref.id}`;
  const r = await db.collection(STUDY_PROGRESS_COLLECTION).findOneAndUpdate(
    { userId: me.userId, scopeKey, passageId: b.passageId },
    {
      ...(b.done ? { $addToSet: { done: itemKey } } : { $pull: { done: itemKey } }),
      $set: { updatedAt: new Date() },
      $setOnInsert: { createdAt: new Date(), loginId: me.loginId },
    } as never,
    { upsert: true, returnDocument: 'after' },
  );
  return NextResponse.json({ ok: true, done: (r?.done as string[] | undefined) ?? [] });
}
