import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { DEFAULT_STUDY_PLAN, STUDY_ACTIVITIES, STUDY_PLANS_COLLECTION, sanitizeStudyPlan } from '@/lib/study-plan';
import { studyPlanMember } from './_auth';

export const dynamic = 'force-dynamic';

/** 내 기본 학습 플랜 (없으면 관리자 기본 설계) */
export async function GET(request: NextRequest) {
  const me = await studyPlanMember(request);
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const db = await getDb('gomijoshua');
  const doc = await db.collection(STUDY_PLANS_COLLECTION).findOne({ userId: me.userId });
  const plan = doc ? sanitizeStudyPlan(doc.plan) : null;
  return NextResponse.json({ plan: plan ?? DEFAULT_STUDY_PLAN, isAdminDefault: !plan, defaultPlan: DEFAULT_STUDY_PLAN, activities: STUDY_ACTIVITIES });
}

/** 내 기본 플랜 저장 */
export async function PUT(request: NextRequest) {
  const me = await studyPlanMember(request);
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { plan?: unknown };
  const plan = sanitizeStudyPlan(body.plan);
  if (!plan) return NextResponse.json({ error: '단계를 하나 이상, 단계마다 활동을 하나 이상 넣어 주세요.' }, { status: 400 });
  const db = await getDb('gomijoshua');
  await db.collection(STUDY_PLANS_COLLECTION).updateOne(
    { userId: me.userId },
    { $set: { plan, loginId: me.loginId, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
    { upsert: true },
  );
  return NextResponse.json({ ok: true, plan });
}

/** 관리자 기본 설계로 되돌리기 */
export async function DELETE(request: NextRequest) {
  const me = await studyPlanMember(request);
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const db = await getDb('gomijoshua');
  await db.collection(STUDY_PLANS_COLLECTION).deleteOne({ userId: me.userId });
  return NextResponse.json({ ok: true, plan: DEFAULT_STUDY_PLAN });
}
