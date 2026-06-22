import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVipMenu } from '@/lib/vip-menu-guard';
import {
  getAttendanceDb,
  VIP_CLASSES_COLLECTION,
  VIP_ATTENDANCES_COLLECTION,
  VIP_CHECKIN_SESSIONS_COLLECTION,
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

/** PATCH — 반 수정. body: { name?, schoolId?, schoolName?, studentIds?, color?, scheduleNote?, status? } */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireVipMenu(request, 'attendance');
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: '잘못된 요청' }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 });
  }

  const $set: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.name === 'string') {
    const n = body.name.trim();
    if (!n) return NextResponse.json({ error: '반 이름을 입력해 주세요.' }, { status: 400 });
    $set.name = n.slice(0, 60);
  }
  if ('schoolId' in body) {
    $set.schoolId =
      typeof body.schoolId === 'string' && ObjectId.isValid(body.schoolId) ? new ObjectId(body.schoolId) : null;
  }
  if (typeof body.schoolName === 'string') $set.schoolName = body.schoolName.trim().slice(0, 80);
  if ('studentIds' in body) $set.studentIds = parseStudentIds(body.studentIds);
  if (typeof body.color === 'string') $set.color = body.color.slice(0, 20);
  if (typeof body.scheduleNote === 'string') $set.scheduleNote = body.scheduleNote.trim().slice(0, 120);
  if (body.status === 'active' || body.status === 'inactive') $set.status = body.status;

  const db = await getAttendanceDb();
  const uid = new ObjectId(auth.userId);
  const r = await db
    .collection<VipClass>(VIP_CLASSES_COLLECTION)
    .updateOne({ _id: new ObjectId(id), userId: uid }, { $set });
  if (r.matchedCount === 0) return NextResponse.json({ error: '반을 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

/** DELETE — 반 + 그 반의 출결·QR세션 cascade 삭제 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireVipMenu(request, 'attendance');
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: '잘못된 요청' }, { status: 400 });

  const db = await getAttendanceDb();
  const uid = new ObjectId(auth.userId);
  const oid = new ObjectId(id);

  const cls = await db.collection<VipClass>(VIP_CLASSES_COLLECTION).findOne({ _id: oid, userId: uid });
  if (!cls) return NextResponse.json({ error: '반을 찾을 수 없습니다.' }, { status: 404 });

  await Promise.all([
    db.collection(VIP_CLASSES_COLLECTION).deleteOne({ _id: oid, userId: uid }),
    db.collection(VIP_ATTENDANCES_COLLECTION).deleteMany({ classId: oid, userId: uid }),
    db.collection(VIP_CHECKIN_SESSIONS_COLLECTION).deleteMany({ classId: oid, userId: uid }),
  ]);
  return NextResponse.json({ ok: true });
}
