import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { requirePremiumMemberVariant } from '@/lib/member-variant-premium-auth';
import {
  FINAL_EXAM_GRADINGS_COLLECTION,
  FINAL_EXAM_FREE_RETRY_LIMIT,
  countRetryJobs,
  createFinalExamShortageOrder,
  generateGradeToken,
  getFinalExamJob,
  insertFinalExamJob,
  selectRetryQuestions,
  type FinalExamJobDoc,
} from '@/lib/final-exam-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 오답 재학습 세트 발급 — 소유자 전용, 원본(구매) 잡당 무료 2회.
 * body: { gradingId } — 그 채점 기록의 오답을 기준으로 새 세트 구성.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePremiumMemberVariant(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  let body: { gradingId?: unknown };
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 });
  }
  const gradingId = typeof body.gradingId === 'string' && ObjectId.isValid(body.gradingId) ? body.gradingId : '';
  if (!gradingId) return NextResponse.json({ error: '채점 기록 id가 필요합니다.' }, { status: 400 });

  try {
    const db = await getDb('gomijoshua');
    const me = await db.collection('users').findOne({ _id: auth.userId }, { projection: { loginId: 1, name: 1 } });
    const loginId = typeof me?.loginId === 'string' ? me.loginId : '';
    if (!loginId) return NextResponse.json({ error: '사용자 정보를 찾을 수 없습니다.' }, { status: 404 });

    const gradedJob = await getFinalExamJob(db, id, loginId);
    if (!gradedJob) return NextResponse.json({ error: '시험지를 찾을 수 없습니다.' }, { status: 404 });

    /* 무료 한도는 원본(구매) 잡 기준 */
    const rootJobId = typeof gradedJob.parentJobId === 'string' && gradedJob.parentJobId
      ? gradedJob.parentJobId
      : String(gradedJob._id);
    const used = await countRetryJobs(db, rootJobId);
    if (used >= FINAL_EXAM_FREE_RETRY_LIMIT) {
      return NextResponse.json(
        { error: `무료 재학습 세트 ${FINAL_EXAM_FREE_RETRY_LIMIT}회를 모두 사용했습니다. 새 파이널 예비 모의고사를 발급해 보세요!`, exhausted: true },
        { status: 400 },
      );
    }

    const grading = await db
      .collection(FINAL_EXAM_GRADINGS_COLLECTION)
      .findOne({ _id: new ObjectId(gradingId), jobId: gradedJob._id });
    if (!grading) return NextResponse.json({ error: '채점 기록을 찾을 수 없습니다.' }, { status: 404 });

    const wrong = (Array.isArray(grading.answers) ? grading.answers : [])
      .filter((a: { isCorrect?: boolean }) => !a.isCorrect)
      .map((a: { sourceKey: string; type: string }) => ({ sourceKey: a.sourceKey, type: a.type }));
    if (wrong.length === 0) {
      return NextResponse.json({ error: '오답이 없습니다. 만점을 축하합니다! 🎉' }, { status: 400 });
    }

    /* 틀린 문항당 새 문항 1개 (같은 지문×유형 → 같은 유형 폴백 → 부족분) */
    const sel = await selectRetryQuestions(db, gradedJob, wrong);

    const now = new Date();
    const retryIndex = used + 1;
    const status = sel.totalShort > 0 ? ('awaiting_admin' as const) : ('ready' as const);
    const rootTitle = gradedJob.title.replace(/^오답 재학습 세트 \d+ — /, '');
    const jobDoc: Omit<FinalExamJobDoc, '_id'> = {
      loginId,
      userId: auth.userId,
      title: `오답 재학습 세트 ${retryIndex} — ${rootTitle}`,
      scopeSummary: `${grading.studentName ?? ''} 오답 ${wrong.length}문항 기반`.trim(),
      selectedTypes: [...new Set(wrong.map((w) => w.type))],
      questionsPerTypeMap: {},
      items: sel.items,
      totalRequested: sel.totalRequested,
      totalAssigned: sel.totalAssigned,
      pointsCharged: 0,
      status,
      gradeToken: generateGradeToken(),
      parentJobId: rootJobId,
      retryIndex,
      createdAt: now,
      updatedAt: now,
      ...(status === 'ready' ? { readyAt: now } : {}),
    };
    const jobId = await insertFinalExamJob(db, jobDoc);

    const shortageOrderNumber = await createFinalExamShortageOrder(db, {
      jobId,
      loginId,
      userName: typeof me?.name === 'string' ? me.name : undefined,
      items: sel.items,
      contextLabel: '파이널 오답 재학습 세트',
    });

    return NextResponse.json({
      ok: true,
      id: jobId,
      status,
      retryIndex,
      remaining: FINAL_EXAM_FREE_RETRY_LIMIT - retryIndex,
      totalRequested: sel.totalRequested,
      totalAssigned: sel.totalAssigned,
      totalShort: sel.totalShort,
      shortageOrderNumber,
    });
  } catch (e) {
    console.error('[final-exams retry POST]', e);
    return NextResponse.json({ error: '재학습 세트 발급에 실패했습니다.' }, { status: 500 });
  }
}
