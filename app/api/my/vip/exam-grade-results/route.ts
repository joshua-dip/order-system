import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVip } from '@/lib/vip-auth';
import { getDb } from '@/lib/mongodb';
import {
  GRADE_PAPERS_COLLECTION,
  GRADE_RESULTS_COLLECTION,
  ensureGradeIndexes,
  type GradePaperDoc,
  type GradeResultDoc,
} from '@/lib/vip-grade-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 선생님 — QR 자가채점 시험지 + 학생 응시 결과 + 유형·지문별 복습 분석. */
export async function GET(request: NextRequest) {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;

  const db = await getDb('gomijoshua');
  await ensureGradeIndexes(db); // 중복 정리(첫 제출만) + 유니크 인덱스 자가 치유
  const userId = new ObjectId(auth.userId);

  const papers = await db
    .collection<GradePaperDoc>(GRADE_PAPERS_COLLECTION)
    .find({ userId })
    .sort({ createdAt: -1 })
    .limit(100)
    .toArray();

  if (papers.length === 0) return NextResponse.json({ ok: true, papers: [] });

  const paperIds = papers.map((p) => p._id as ObjectId);
  const results = await db
    .collection<GradeResultDoc>(GRADE_RESULTS_COLLECTION)
    .find({ paperId: { $in: paperIds } })
    .sort({ createdAt: -1 })
    .toArray();

  const byPaper = new Map<string, GradeResultDoc[]>();
  for (const r of results) {
    const k = String(r.paperId);
    if (!byPaper.has(k)) byPaper.set(k, []);
    byPaper.get(k)!.push(r);
  }

  const out = papers.map((p) => {
    const rs = byPaper.get(String(p._id)) ?? [];
    // 학생 전체 집계 (유형·지문별 정답/총합)
    const aggType = new Map<string, { correct: number; total: number }>();
    const aggSrc = new Map<string, { correct: number; total: number }>();
    let pctSum = 0;
    for (const r of rs) {
      for (const t of r.byType) {
        const a = aggType.get(t.type) ?? { correct: 0, total: 0 };
        a.correct += t.correct; a.total += t.total; aggType.set(t.type, a);
      }
      for (const s of r.bySource) {
        const a = aggSrc.get(s.sourceKey) ?? { correct: 0, total: 0 };
        a.correct += s.correct; a.total += s.total; aggSrc.set(s.sourceKey, a);
      }
      pctSum += r.objectiveCount > 0 ? (r.correctCount / r.objectiveCount) * 100 : 0;
    }
    const toArr = (m: Map<string, { correct: number; total: number }>) =>
      [...m.entries()]
        .map(([key, v]) => ({ key, correct: v.correct, total: v.total, pct: v.total > 0 ? Math.round((v.correct / v.total) * 100) : 0 }))
        .sort((a, b) => a.pct - b.pct); // 낮은 정답률(복습 우선) 먼저

    return {
      paperId: String(p._id),
      title: p.title,
      schoolName: p.schoolName ?? '',
      grade: p.grade ?? null,
      objectiveCount: p.objectiveCount,
      subjectiveCount: p.subjectiveCount,
      maxObjectiveScore: p.maxObjectiveScore,
      totalScore: p.totalScore,
      token: p.token,
      createdAt: p.createdAt,
      studentCount: rs.length,
      avgPct: rs.length > 0 ? Math.round(pctSum / rs.length) : 0,
      byType: toArr(aggType).map((x) => ({ type: x.key, correct: x.correct, total: x.total, pct: x.pct })),
      bySource: toArr(aggSrc).map((x) => ({ sourceKey: x.key, correct: x.correct, total: x.total, pct: x.pct })),
      students: rs.map((r) => ({
        resultId: String(r._id),
        studentName: r.studentName,
        correctCount: r.correctCount,
        objectiveCount: r.objectiveCount,
        earnedScore: r.earnedScore,
        maxObjectiveScore: r.maxObjectiveScore,
        weakTypes: r.byType.filter((t) => t.correct < t.total).sort((a, b) => a.correct / a.total - b.correct / b.total).map((t) => t.type),
        createdAt: r.createdAt,
      })),
    };
  });

  return NextResponse.json({ ok: true, papers: out });
}

/**
 * 기록 삭제 (선생님 본인 것만).
 *  - ?paperId=…  → 시험지 + 그 시험지의 모든 응시 기록 삭제
 *  - ?resultId=… → 학생 1명의 응시 기록만 삭제
 */
export async function DELETE(request: NextRequest) {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;

  const db = await getDb('gomijoshua');
  const userId = new ObjectId(auth.userId);
  const sp = request.nextUrl.searchParams;
  const paperId = sp.get('paperId');
  const resultId = sp.get('resultId');

  if (resultId && ObjectId.isValid(resultId)) {
    const r = await db.collection(GRADE_RESULTS_COLLECTION).deleteOne({ _id: new ObjectId(resultId), userId });
    if (r.deletedCount === 0) return NextResponse.json({ error: '기록을 찾을 수 없습니다.' }, { status: 404 });
    return NextResponse.json({ ok: true, deletedResults: r.deletedCount });
  }

  if (paperId && ObjectId.isValid(paperId)) {
    const pid = new ObjectId(paperId);
    const paper = await db.collection(GRADE_PAPERS_COLLECTION).findOne({ _id: pid, userId });
    if (!paper) return NextResponse.json({ error: '시험지를 찾을 수 없습니다.' }, { status: 404 });
    const g = await db.collection(GRADE_RESULTS_COLLECTION).deleteMany({ paperId: pid, userId });
    await db.collection(GRADE_PAPERS_COLLECTION).deleteOne({ _id: pid, userId });
    return NextResponse.json({ ok: true, deletedPaper: 1, deletedResults: g.deletedCount });
  }

  return NextResponse.json({ error: 'paperId 또는 resultId 가 필요합니다.' }, { status: 400 });
}
