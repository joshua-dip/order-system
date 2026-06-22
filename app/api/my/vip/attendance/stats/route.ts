import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVipMenu } from '@/lib/vip-menu-guard';
import {
  getAttendanceDb,
  loadClassRoster,
  normalizeDate,
  ATTENDANCE_STATUSES,
  VIP_ATTENDANCES_COLLECTION,
  type VipAttendance,
  type AttendanceStatus,
} from '@/lib/attendance-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function emptyCounts(): Record<AttendanceStatus, number> {
  return { present: 0, late: 0, earlyLeave: 0, absent: 0 };
}

/** GET — 반별 학생 출결 집계. query: classId, from?, to? (YYYY-MM-DD) */
export async function GET(request: NextRequest) {
  const auth = await requireVipMenu(request, 'attendance');
  if (auth instanceof NextResponse) return auth;

  const sp = request.nextUrl.searchParams;
  const classIdRaw = sp.get('classId') ?? '';
  if (!ObjectId.isValid(classIdRaw)) return NextResponse.json({ error: '반을 선택해 주세요.' }, { status: 400 });

  const today = new Date();
  const dflt = new Date(today.getTime() - 29 * 86400000);
  const to = normalizeDate(sp.get('to')) ?? today.toISOString().slice(0, 10);
  const from = normalizeDate(sp.get('from')) ?? dflt.toISOString().slice(0, 10);

  const db = await getAttendanceDb();
  const uid = new ObjectId(auth.userId);
  const classId = new ObjectId(classIdRaw);

  const { cls, students } = await loadClassRoster(db, uid, classId);
  if (!cls) return NextResponse.json({ error: '반을 찾을 수 없습니다.' }, { status: 404 });

  const recs = await db
    .collection<VipAttendance>(VIP_ATTENDANCES_COLLECTION)
    .find({ userId: uid, classId, date: { $gte: from, $lte: to } })
    .project({ studentId: 1, status: 1, date: 1, sessionLabel: 1 })
    .toArray();

  const byStudent = new Map<string, Record<AttendanceStatus, number>>();
  const sessionKeys = new Set<string>();
  for (const r of recs) {
    sessionKeys.add(`${r.date}|${r.sessionLabel}`);
    const sid = String(r.studentId);
    const c = byStudent.get(sid) ?? emptyCounts();
    if ((ATTENDANCE_STATUSES as string[]).includes(r.status)) c[r.status as AttendanceStatus] += 1;
    byStudent.set(sid, c);
  }

  const rows = students.map((s) => {
    const c = byStudent.get(s.id) ?? emptyCounts();
    const total = c.present + c.late + c.earlyLeave + c.absent;
    const attended = c.present + c.late + c.earlyLeave; // 결석 외 출석 인정
    return {
      id: s.id,
      name: s.name,
      counts: c,
      total,
      rate: total > 0 ? Math.round((attended / total) * 100) : null,
    };
  });

  return NextResponse.json({
    ok: true,
    class: { id: String(cls._id), name: cls.name },
    from,
    to,
    sessionCount: sessionKeys.size,
    students: rows,
  });
}
