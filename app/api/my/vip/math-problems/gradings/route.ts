import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVipMenu } from '@/lib/vip-menu-guard';
import { getDb } from '@/lib/mongodb';
import {
  MATH_GRADE_PAPERS_COLLECTION,
  MATH_GRADE_RESULTS_COLLECTION,
  type MathGradePaperDoc,
  type MathGradeResultDoc,
} from '@/lib/vip-math-grade-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET — 선생님의 수학 QR 채점 결과 (채점지별 학생 제출 목록).
 * DELETE — ?paperId= 채점지(+결과) 삭제.
 */
export async function GET(request: NextRequest) {
  const auth = await requireVipMenu(request, 'math-problems');
  if (auth instanceof NextResponse) return auth;
  const db = await getDb('gomijoshua');
  const userId = new ObjectId(auth.userId);

  const papers = await db.collection<MathGradePaperDoc>(MATH_GRADE_PAPERS_COLLECTION)
    .find({ userId }).sort({ createdAt: -1 }).limit(200).toArray();
  if (papers.length === 0) return NextResponse.json({ ok: true, papers: [] });

  const paperIds = papers.map((p) => p._id as ObjectId);
  const results = await db.collection<MathGradeResultDoc>(MATH_GRADE_RESULTS_COLLECTION)
    .find({ paperId: { $in: paperIds } }).toArray();
  const byPaper = new Map<string, MathGradeResultDoc[]>();
  for (const r of results) {
    const k = String(r.paperId);
    (byPaper.get(k) ?? byPaper.set(k, []).get(k)!).push(r);
  }

  return NextResponse.json({
    ok: true,
    papers: papers.map((p) => {
      const rs = (byPaper.get(String(p._id)) ?? []).sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime());
      return {
        id: String(p._id),
        token: p.token,
        title: p.title,
        교과: p.교과 ?? '',
        학습주제: p.학습주제 ?? '',
        topicKey: p.topicKey ?? '',
        questionCount: p.questions?.length ?? 0,
        objectiveCount: p.objectiveCount ?? 0,
        subjectiveCount: p.subjectiveCount ?? 0,
        maxScore: p.maxScore ?? 0,
        createdAt: p.createdAt,
        resultCount: rs.length,
        results: rs.map((r) => ({
          studentName: r.studentName,
          studentPhone: r.studentPhone,
          correctCount: r.correctCount,
          totalCount: r.totalCount,
          earnedScore: r.earnedScore,
          maxScore: r.maxScore,
          selfCorrectCount: r.selfCorrectCount ?? r.correctCount,
          selfEarnedScore: r.selfEarnedScore ?? r.earnedScore,
          wrongNums: (r.answers ?? []).filter((a) => !a.isCorrect).map((a) => a.num),
          retake: r.retake ? { correctCount: r.retake.correctCount, totalCount: r.retake.totalCount, earnedScore: r.retake.earnedScore, attemptCount: r.retake.attemptCount } : null,
          createdAt: r.createdAt,
        })),
      };
    }),
  });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireVipMenu(request, 'math-problems');
  if (auth instanceof NextResponse) return auth;
  const paperId = request.nextUrl.searchParams.get('paperId') ?? '';
  if (!ObjectId.isValid(paperId)) return NextResponse.json({ error: 'paperId 오류' }, { status: 400 });
  const db = await getDb('gomijoshua');
  const userId = new ObjectId(auth.userId);
  const pid = new ObjectId(paperId);
  const paper = await db.collection(MATH_GRADE_PAPERS_COLLECTION).findOne({ _id: pid, userId });
  if (!paper) return NextResponse.json({ error: '채점지를 찾을 수 없습니다.' }, { status: 404 });
  await db.collection(MATH_GRADE_RESULTS_COLLECTION).deleteMany({ paperId: pid });
  await db.collection(MATH_GRADE_PAPERS_COLLECTION).deleteOne({ _id: pid, userId });
  return NextResponse.json({ ok: true });
}
