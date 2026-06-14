import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import {
  FINAL_EXAM_GRADINGS_COLLECTION,
  FINAL_EXAM_FREE_RETRY_LIMIT,
  countRetryJobs,
  getFinalExamJobByToken,
  loadExamQuestions,
} from '@/lib/final-exam-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 채점 결과 보고서 — 토큰 + 채점 id 로 공개 조회 (오답 상세·해설 포함) */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const gradingId = request.nextUrl.searchParams.get('g') ?? '';
  if (!ObjectId.isValid(gradingId)) {
    return NextResponse.json({ error: '유효하지 않은 채점 기록입니다.' }, { status: 400 });
  }

  try {
    const db = await getDb('gomijoshua');
    const job = await getFinalExamJobByToken(db, token);
    if (!job) return NextResponse.json({ error: '유효하지 않은 시험지입니다.' }, { status: 404 });

    const grading = await db
      .collection(FINAL_EXAM_GRADINGS_COLLECTION)
      .findOne({ _id: new ObjectId(gradingId), jobId: job._id });
    if (!grading) return NextResponse.json({ error: '채점 기록을 찾을 수 없습니다.' }, { status: 404 });

    /* 오답 상세 — 문항 본문·해설 (시험지와 동일 순서 로더 재사용) */
    const questions = await loadExamQuestions(db, job);
    const byNum = new Map(questions.map((q) => [q.num, q]));
    const answers = Array.isArray(grading.answers) ? grading.answers : [];
    const wrongDetails = answers
      .filter((a: { isCorrect?: boolean }) => !a.isCorrect)
      .map((a: { num: number; type: string; sourceKey: string; chosen: string; correct: string }) => {
        const q = byNum.get(a.num);
        return {
          num: a.num,
          type: a.type,
          sourceKey: a.sourceKey,
          chosen: a.chosen || '(무응답)',
          correct: a.correct,
          question: q?.question ?? '',
          explanation: q?.explanation ?? '',
        };
      });

    /* 소유자 + 재학습 세트 잔여 횟수 */
    const cookieToken = request.cookies.get(COOKIE_NAME)?.value;
    const payload = cookieToken ? await verifyToken(cookieToken) : null;
    const isOwner = payload?.loginId != null && payload.loginId === job.loginId;
    const rootJobId = typeof job.parentJobId === 'string' && job.parentJobId ? job.parentJobId : String(job._id);
    const retryUsed = await countRetryJobs(db, rootJobId);

    return NextResponse.json({
      title: job.title,
      scopeSummary: job.scopeSummary,
      studentName: grading.studentName ?? '',
      score: grading.score ?? 0,
      total: grading.total ?? 0,
      byType: Array.isArray(grading.byType) ? grading.byType : [],
      bySource: Array.isArray(grading.bySource) ? grading.bySource : [],
      wrongDetails,
      createdAt: grading.createdAt instanceof Date ? grading.createdAt.toISOString() : String(grading.createdAt ?? ''),
      retry: {
        used: retryUsed,
        limit: FINAL_EXAM_FREE_RETRY_LIMIT,
        canIssue: isOwner && retryUsed < FINAL_EXAM_FREE_RETRY_LIMIT && wrongDetails.length > 0,
        isOwner,
        jobId: String(job._id),
      },
    });
  } catch (e) {
    console.error('[grade result GET]', e);
    return NextResponse.json({ error: '보고서를 불러오지 못했습니다.' }, { status: 500 });
  }
}
