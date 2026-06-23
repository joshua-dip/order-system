import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVip } from '@/lib/vip-auth';
import { getVipDb, ensureVipIndexes, col } from '@/lib/vip-db';
import { VIP_ASSIGNMENTS_COLLECTION } from '@/lib/vip-assignment-store';
import { GRADE_PAPERS_COLLECTION } from '@/lib/vip-grade-store';
import { VIP_TUITION_COLLECTION } from '@/lib/vip-tuition-store';

export async function GET(request: NextRequest) {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;

  const db = await getVipDb();
  await ensureVipIndexes(db);

  const uid = new ObjectId(auth.userId);
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [studentCount, schoolCount, examCount, recentExams, homeworkActive, qrGradedPapers, unpaidCount] = await Promise.all([
    col(db, 'students').countDocuments({ userId: uid }).catch(() => 0),
    col(db, 'schools').countDocuments({ userId: uid }).catch(() => 0),
    col(db, 'schoolExams').countDocuments({ userId: uid }).catch(() => 0),
    col(db, 'schoolExams')
      .aggregate([
        { $match: { userId: uid } },
        { $sort: { createdAt: -1 } },
        { $limit: 5 },
        {
          $lookup: {
            from: 'vip_schools',
            localField: 'schoolId',
            foreignField: '_id',
            as: 'school',
          },
        },
        { $unwind: { path: '$school', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            schoolName: '$school.name',
            examType: 1,
            grade: 1,
            academicYear: 1,
          },
        },
      ])
      .toArray()
      .catch(() => []),
    db.collection(VIP_ASSIGNMENTS_COLLECTION).countDocuments({ userId: uid, targets: { $elemMatch: { status: { $ne: 'done' } } } }).catch(() => 0),
    db.collection(GRADE_PAPERS_COLLECTION).countDocuments({ userId: uid }).catch(() => 0),
    db.collection(VIP_TUITION_COLLECTION).countDocuments({ userId: uid, month, status: 'unpaid' }).catch(() => 0),
  ]);

  return NextResponse.json({
    ok: true,
    stats: {
      studentCount,
      schoolCount,
      examCount,
      homeworkActive,
      qrGradedPapers,
      unpaidCount,
      month,
      recentExams: recentExams.map((e) => ({
        id: e._id?.toString() ?? '',
        schoolName: e.schoolName ?? '',
        examType: e.examType,
        grade: e.grade,
        academicYear: e.academicYear,
      })),
    },
  });
}
