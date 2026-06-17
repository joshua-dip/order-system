import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import {
  getAttendanceDb,
  getCheckinSessionByToken,
  loadClassRoster,
  upsertAttendance,
  VIP_ATTENDANCES_COLLECTION,
  type VipAttendance,
} from '@/lib/attendance-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET — 무로그인 체크인 페이지용 세션 정보 + 학생 명단(체크인 여부). 민감정보 없음. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = await getAttendanceDb();
  const session = await getCheckinSessionByToken(db, token);
  if (!session) return NextResponse.json({ error: '유효하지 않은 출석 링크입니다.' }, { status: 404 });

  const { cls, students } = await loadClassRoster(db, session.userId, session.classId);
  if (!cls) return NextResponse.json({ error: '반 정보를 찾을 수 없습니다.' }, { status: 404 });

  const recs = await db
    .collection<VipAttendance>(VIP_ATTENDANCES_COLLECTION)
    .find({ userId: session.userId, classId: session.classId, date: session.date, sessionLabel: session.sessionLabel })
    .project({ studentId: 1 })
    .toArray();
  const checkedIn = new Set(recs.map((r) => String(r.studentId)));

  return NextResponse.json({
    ok: true,
    open: session.open,
    className: cls.name,
    date: session.date,
    sessionLabel: session.sessionLabel,
    students: students.map((s) => ({ id: s.id, name: s.name, checkedIn: checkedIn.has(s.id) })),
  });
}

/** POST — 학생 본인 출석 체크인. body: { studentId } */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 });
  }
  const studentId = typeof body.studentId === 'string' ? body.studentId : '';

  const db = await getAttendanceDb();
  const session = await getCheckinSessionByToken(db, token);
  if (!session) return NextResponse.json({ error: '유효하지 않은 출석 링크입니다.' }, { status: 404 });
  if (!session.open) return NextResponse.json({ error: '출석이 마감되었습니다.' }, { status: 403 });
  if (!ObjectId.isValid(studentId)) return NextResponse.json({ error: '학생을 선택해 주세요.' }, { status: 400 });

  const { cls, students } = await loadClassRoster(db, session.userId, session.classId);
  if (!cls) return NextResponse.json({ error: '반 정보를 찾을 수 없습니다.' }, { status: 404 });
  const me = students.find((s) => s.id === studentId);
  if (!me) return NextResponse.json({ error: '명단에 없는 학생입니다.' }, { status: 400 });

  await upsertAttendance(db, {
    userId: session.userId,
    classId: session.classId,
    date: session.date,
    sessionLabel: session.sessionLabel,
    studentId: new ObjectId(studentId),
    studentName: me.name,
    status: 'present',
    reason: null,
    source: 'qr',
    checkedInAt: new Date(),
  });

  return NextResponse.json({ ok: true, studentName: me.name });
}
