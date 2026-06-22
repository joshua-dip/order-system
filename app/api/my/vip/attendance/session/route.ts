import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVipMenu } from '@/lib/vip-menu-guard';
import {
  getAttendanceDb,
  ensureAttendanceIndexes,
  loadClassRoster,
  upsertAttendance,
  normalizeDate,
  isAttendanceStatus,
  ABSENCE_REASONS,
  VIP_ATTENDANCES_COLLECTION,
  type VipAttendance,
  type AbsenceReason,
} from '@/lib/attendance-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function normReason(v: unknown): AbsenceReason | null {
  return typeof v === 'string' && (ABSENCE_REASONS as string[]).includes(v) ? (v as AbsenceReason) : null;
}

/** GET — 반 명단 + 해당 (반,날짜,교시) 기존 출결 병합 */
export async function GET(request: NextRequest) {
  const auth = await requireVipMenu(request, 'attendance');
  if (auth instanceof NextResponse) return auth;

  const sp = request.nextUrl.searchParams;
  const classIdRaw = sp.get('classId') ?? '';
  const date = normalizeDate(sp.get('date'));
  const sessionLabel = (sp.get('sessionLabel') ?? '').trim();
  if (!ObjectId.isValid(classIdRaw) || !date) {
    return NextResponse.json({ error: '반과 날짜를 선택해 주세요.' }, { status: 400 });
  }

  const db = await getAttendanceDb();
  await ensureAttendanceIndexes(db);
  const uid = new ObjectId(auth.userId);
  const classId = new ObjectId(classIdRaw);

  const { cls, students } = await loadClassRoster(db, uid, classId);
  if (!cls) return NextResponse.json({ error: '반을 찾을 수 없습니다.' }, { status: 404 });

  const recs = await db
    .collection<VipAttendance>(VIP_ATTENDANCES_COLLECTION)
    .find({ userId: uid, classId, date, sessionLabel })
    .toArray();
  const byStudent = new Map(recs.map((r) => [String(r.studentId), r]));

  const merged = students.map((s) => {
    const r = byStudent.get(s.id);
    return {
      id: s.id,
      name: s.name,
      grade: s.grade ?? null,
      status: r?.status ?? null,
      reason: r?.reason ?? null,
      memo: r?.memo ?? '',
      source: r?.source ?? null,
      checkedInAt: r?.checkedInAt ?? null,
    };
  });

  return NextResponse.json({
    ok: true,
    class: { id: String(cls._id), name: cls.name },
    date,
    sessionLabel,
    students: merged,
  });
}

/** POST — 출결 일괄 저장. body: { classId, date, sessionLabel?, records:[{studentId,status,reason?,memo?}] } */
export async function POST(request: NextRequest) {
  const auth = await requireVipMenu(request, 'attendance');
  if (auth instanceof NextResponse) return auth;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 });
  }

  const classIdRaw = typeof body.classId === 'string' ? body.classId : '';
  const date = normalizeDate(body.date);
  const sessionLabel = typeof body.sessionLabel === 'string' ? body.sessionLabel.trim().slice(0, 30) : '';
  if (!ObjectId.isValid(classIdRaw) || !date) {
    return NextResponse.json({ error: '반과 날짜를 선택해 주세요.' }, { status: 400 });
  }
  const records = Array.isArray(body.records) ? body.records : [];

  const db = await getAttendanceDb();
  await ensureAttendanceIndexes(db);
  const uid = new ObjectId(auth.userId);
  const classId = new ObjectId(classIdRaw);

  const { cls, students } = await loadClassRoster(db, uid, classId);
  if (!cls) return NextResponse.json({ error: '반을 찾을 수 없습니다.' }, { status: 404 });
  const nameById = new Map(students.map((s) => [s.id, s.name]));

  let saved = 0;
  for (const r of records as Array<Record<string, unknown>>) {
    const sid = typeof r.studentId === 'string' ? r.studentId : '';
    if (!ObjectId.isValid(sid) || !nameById.has(sid)) continue;
    if (!isAttendanceStatus(r.status)) continue;
    await upsertAttendance(db, {
      userId: uid,
      classId,
      date,
      sessionLabel,
      studentId: new ObjectId(sid),
      studentName: nameById.get(sid) ?? '',
      status: r.status,
      reason: r.status === 'present' ? null : normReason(r.reason),
      memo: typeof r.memo === 'string' ? r.memo.slice(0, 200) : '',
      source: 'teacher',
    });
    saved += 1;
  }

  return NextResponse.json({ ok: true, saved });
}
