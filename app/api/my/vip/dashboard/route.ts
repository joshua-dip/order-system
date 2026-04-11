import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVip } from '@/lib/vip-auth';
import { getVipDb, ensureVipIndexes, col } from '@/lib/vip-db';

export async function GET(request: NextRequest) {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;

  const db = await getVipDb();
  await ensureVipIndexes(db);

  const uid = new ObjectId(auth.userId);
  const [studentCount, schoolCount, examCount, recentExams] = await Promise.all([
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
  ]);

  return NextResponse.json({
    ok: true,
    stats: {
      studentCount,
      schoolCount,
      examCount,
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
