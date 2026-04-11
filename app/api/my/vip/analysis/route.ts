import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVip } from '@/lib/vip-auth';
import { getVipDb, ensureVipIndexes, col, type VipSchoolExam, type VipStudentScore } from '@/lib/vip-db';

export async function GET(request: NextRequest) {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;

  const db = await getVipDb();
  await ensureVipIndexes(db);
  const uid = new ObjectId(auth.userId);

  const sp = request.nextUrl.searchParams;
  const schoolId = sp.get('schoolId');
  if (!schoolId) return NextResponse.json({ error: 'schoolId가 필요합니다.' }, { status: 400 });

  const filter: Record<string, unknown> = { userId: uid, schoolId: new ObjectId(schoolId) };
  if (sp.get('academicYear')) filter.academicYear = Number(sp.get('academicYear'));
  if (sp.get('grade')) filter.grade = Number(sp.get('grade'));

  const exams = await col<VipSchoolExam>(db, 'schoolExams').find(filter).sort({ academicYear: -1, examType: 1 }).toArray();
  if (exams.length === 0) return NextResponse.json({ ok: true, analysis: null });

  const examIds = exams.map((e) => e._id!);
  const allScores = await col<VipStudentScore>(db, 'studentScores')
    .find({ userId: uid, schoolExamId: { $in: examIds } })
    .toArray();

  const scoresByExam = new Map<string, VipStudentScore[]>();
  for (const s of allScores) {
    const key = s.schoolExamId.toString();
    if (!scoresByExam.has(key)) scoresByExam.set(key, []);
    scoresByExam.get(key)!.push(s);
  }

  const students = await col(db, 'students')
    .find({ userId: uid, schoolId: new ObjectId(schoolId) })
    .project({ name: 1, grade: 1 })
    .toArray();
  const studentMap = new Map(students.map((s) => [s._id.toString(), s.name as string]));

  const examAnalyses = exams.map((exam) => {
    const examScores = scoresByExam.get(exam._id!.toString()) || [];
    const questions = exam.questions || {};
    const totalQ = exam.objectiveCount + exam.subjectiveCount;

    // Type distribution
    const typeCount: Record<string, number> = {};
    const textbookCount: Record<string, number> = {};
    let totalScore = 0;
    for (const [, q] of Object.entries(questions)) {
      if (q.questionType) typeCount[q.questionType] = (typeCount[q.questionType] || 0) + 1;
      if (q.textbook) textbookCount[q.textbook] = (textbookCount[q.textbook] || 0) + 1;
      totalScore += q.score || 0;
    }

    // Score distribution
    const scores = examScores.map((s) => s.totalScore);
    const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const maxScore = scores.length ? Math.max(...scores) : 0;
    const minScore = scores.length ? Math.min(...scores) : 0;

    // Per-question accuracy
    const perQuestion: Record<string, { correct: number; total: number }> = {};
    for (const sc of examScores) {
      for (const [qn, val] of Object.entries(sc.answers)) {
        if (!perQuestion[qn]) perQuestion[qn] = { correct: 0, total: 0 };
        perQuestion[qn].total++;
        const maxVal = questions[qn]?.score || 0;
        if (val >= maxVal && maxVal > 0) perQuestion[qn].correct++;
      }
    }

    // Student ranking
    const rankings = examScores
      .map((s) => ({
        studentId: s.studentId.toString(),
        studentName: studentMap.get(s.studentId.toString()) || '?',
        totalScore: s.totalScore,
        objectiveScore: s.objectiveScore,
        subjectiveScore: s.subjectiveScore,
      }))
      .sort((a, b) => b.totalScore - a.totalScore);

    return {
      examId: exam._id!.toString(),
      examType: exam.examType,
      grade: exam.grade,
      academicYear: exam.academicYear,
      totalQuestions: totalQ,
      totalMaxScore: totalScore,
      studentCount: examScores.length,
      avgScore: Math.round(avgScore * 10) / 10,
      maxScore, minScore,
      typeDistribution: typeCount,
      textbookCoverage: textbookCount,
      perQuestionAccuracy: Object.entries(perQuestion).map(([qn, v]) => ({
        question: Number(qn),
        accuracy: v.total > 0 ? Math.round((v.correct / v.total) * 100) : 0,
        total: v.total,
      })).sort((a, b) => a.question - b.question),
      rankings,
    };
  });

  return NextResponse.json({ ok: true, analysis: examAnalyses });
}
