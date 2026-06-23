import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVipMenu } from '@/lib/vip-menu-guard';
import { getVipDb, ensureVipIndexes, col, type VipStudent, type VipStudentScore, type VipSchoolExam } from '@/lib/vip-db';
import { VIP_ATTENDANCES_COLLECTION, type VipAttendance } from '@/lib/attendance-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function examMax(exam: VipSchoolExam): number {
  return Object.values(exam.questions ?? {}).reduce((s, q) => s + (Number(q?.score) || 0), 0);
}

/**
 * GET /api/my/vip/report?studentId=
 * 한 학생의 학습 리포트 — 시험별 성적 추이(반평균·석차 포함) + 출결 요약.
 */
export async function GET(request: NextRequest) {
  const auth = await requireVipMenu(request, 'report');
  if (auth instanceof NextResponse) return auth;

  const studentId = request.nextUrl.searchParams.get('studentId');
  if (!studentId || !ObjectId.isValid(studentId)) return NextResponse.json({ error: 'studentId 가 필요합니다.' }, { status: 400 });

  const db = await getVipDb();
  await ensureVipIndexes(db);
  const uid = new ObjectId(auth.userId);
  const sid = new ObjectId(studentId);

  const student = await col<VipStudent>(db, 'students').findOne({ _id: sid, userId: uid });
  if (!student) return NextResponse.json({ error: '학생을 찾을 수 없습니다.' }, { status: 404 });

  // 이 학생의 모든 성적
  const myScores = await col<VipStudentScore>(db, 'studentScores').find({ userId: uid, studentId: sid }).toArray();
  const examIds = myScores.map((s) => s.schoolExamId);

  const exams = examIds.length
    ? await col<VipSchoolExam>(db, 'schoolExams').find({ _id: { $in: examIds } }).toArray()
    : [];
  const examById = new Map(exams.map((e) => [String(e._id), e]));

  // 시험별 전체 성적(반평균·석차)
  const allScores = examIds.length
    ? await col<VipStudentScore>(db, 'studentScores').find({ userId: uid, schoolExamId: { $in: examIds } }).toArray()
    : [];
  const scoresByExam = new Map<string, number[]>();
  for (const s of allScores) {
    const k = String(s.schoolExamId);
    (scoresByExam.get(k) ?? scoresByExam.set(k, []).get(k)!).push(s.totalScore ?? 0);
  }

  const examRows = myScores.map((s) => {
    const ex = examById.get(String(s.schoolExamId));
    const peers = (scoresByExam.get(String(s.schoolExamId)) ?? []).slice().sort((a, b) => b - a);
    const my = s.totalScore ?? 0;
    const rank = peers.findIndex((v) => v <= my) >= 0 ? peers.filter((v) => v > my).length + 1 : null;
    const avg = peers.length ? Math.round((peers.reduce((a, b) => a + b, 0) / peers.length) * 10) / 10 : null;
    return {
      schoolExamId: String(s.schoolExamId),
      examName: ex ? `${ex.academicYear}년 ${ex.examType}` : '시험',
      subject: (ex as { subject?: string } | undefined)?.subject ?? '영어',
      grade: ex?.grade ?? null,
      total: my,
      objective: s.objectiveScore ?? 0,
      subjective: s.subjectiveScore ?? 0,
      max: ex ? examMax(ex) : null,
      classAvg: avg,
      rank,
      classSize: peers.length,
    };
  }).sort((a, b) => a.examName.localeCompare(b.examName));

  // 출결 요약
  const att = await db.collection<VipAttendance>(VIP_ATTENDANCES_COLLECTION)
    .find({ userId: uid, studentId: sid }).project({ status: 1 }).toArray();
  const counts = { present: 0, late: 0, earlyLeave: 0, absent: 0 };
  for (const a of att) { const st = a.status as keyof typeof counts; if (st in counts) counts[st] += 1; }
  const attTotal = counts.present + counts.late + counts.earlyLeave + counts.absent;
  const attendance = {
    ...counts,
    total: attTotal,
    rate: attTotal > 0 ? Math.round(((counts.present + counts.late + counts.earlyLeave) / attTotal) * 100) : null,
  };

  // 평균(내 성적 / 만점 비율)
  const pcts = examRows.filter((r) => r.max).map((r) => (r.total / (r.max as number)) * 100);
  const avgPct = pcts.length ? Math.round((pcts.reduce((a, b) => a + b, 0) / pcts.length)) : null;

  return NextResponse.json({
    ok: true,
    student: { id: String(student._id), name: student.name, schoolName: student.schoolName ?? '', grade: student.grade ?? null },
    exams: examRows,
    attendance,
    avgPct,
  });
}
