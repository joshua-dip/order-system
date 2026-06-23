import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVipMenu } from '@/lib/vip-menu-guard';
import {
  getAttendanceDb,
  ensureAttendanceIndexes,
  VIP_CLASSES_COLLECTION,
  type VipClass,
} from '@/lib/attendance-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseStudentIds(v: unknown): ObjectId[] {
  if (!Array.isArray(v)) return [];
  const out: ObjectId[] = [];
  const seen = new Set<string>();
  for (const x of v) {
    if (typeof x === 'string' && ObjectId.isValid(x) && !seen.has(x)) {
      seen.add(x);
      out.push(new ObjectId(x));
    }
  }
  return out;
}

/** GET — 반 목록(학생 수 포함) */
export async function GET(request: NextRequest) {
  const auth = await requireVipMenu(request, 'attendance');
  if (auth instanceof NextResponse) return auth;

  const db = await getAttendanceDb();
  await ensureAttendanceIndexes(db);
  const uid = new ObjectId(auth.userId);

  const docs = await db
    .collection<VipClass>(VIP_CLASSES_COLLECTION)
    .find({ userId: uid })
    .sort({ status: 1, createdAt: -1 })
    .toArray();

  const classes = docs.map((c) => ({
    id: String(c._id),
    name: c.name,
    schoolId: c.schoolId ? String(c.schoolId) : null,
    schoolName: c.schoolName ?? '',
    studentIds: (c.studentIds ?? []).map((x) => String(x)),
    studentCount: (c.studentIds ?? []).length,
    color: c.color ?? '',
    scheduleNote: c.scheduleNote ?? '',
    status: c.status,
    createdAt: c.createdAt,
  }));

  return NextResponse.json({ ok: true, classes });
}

/** POST — 반 생성. body: { name, schoolId?, schoolName?, studentIds?, color?, scheduleNote? } */
export async function POST(request: NextRequest) {
  const auth = await requireVipMenu(request, 'attendance');
  if (auth instanceof NextResponse) return auth;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ error: '반 이름을 입력해 주세요.' }, { status: 400 });

  const db = await getAttendanceDb();
  await ensureAttendanceIndexes(db);
  const uid = new ObjectId(auth.userId);

  const schoolId =
    typeof body.schoolId === 'string' && ObjectId.isValid(body.schoolId) ? new ObjectId(body.schoolId) : null;
  const doc: Omit<VipClass, '_id'> = {
    userId: uid,
    name: name.slice(0, 60),
    schoolId,
    schoolName: typeof body.schoolName === 'string' ? body.schoolName.trim().slice(0, 80) : '',
    studentIds: parseStudentIds(body.studentIds),
    color: typeof body.color === 'string' ? body.color.slice(0, 20) : '',
    scheduleNote: typeof body.scheduleNote === 'string' ? body.scheduleNote.trim().slice(0, 120) : '',
    status: 'active',
    createdAt: new Date(),
  };

  const r = await db.collection<VipClass>(VIP_CLASSES_COLLECTION).insertOne(doc as VipClass);
  return NextResponse.json({ ok: true, id: String(r.insertedId) }, { status: 201 });
}
