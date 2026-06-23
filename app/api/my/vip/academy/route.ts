import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVipMenu } from '@/lib/vip-menu-guard';
import { getVipDb } from '@/lib/vip-db';
import {
  VIP_ACADEMY_COLLECTION,
  ensureAcademyIndexes,
  sanitizeAcademy,
  type VipAcademyInfo,
} from '@/lib/vip-academy-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function view(c: VipAcademyInfo) {
  return {
    id: String(c._id),
    name: c.name,
    regNumber: c.regNumber,
    owner: c.owner,
    address: c.address,
    phone: c.phone,
    subjects: c.subjects,
    capacity: c.capacity,
    openDate: c.openDate,
    note: c.note,
    updatedAt: c.updatedAt,
  };
}

/** GET — 회원의 학원 교습소 정보 1건 (없으면 null). */
export async function GET(request: NextRequest) {
  const auth = await requireVipMenu(request, 'academy');
  if (auth instanceof NextResponse) return auth;
  const db = await getVipDb();
  await ensureAcademyIndexes(db);
  const uid = new ObjectId(auth.userId);

  const doc = await db.collection<VipAcademyInfo>(VIP_ACADEMY_COLLECTION).findOne({ userId: uid });
  return NextResponse.json({ ok: true, info: doc ? view(doc) : null });
}

/** POST — 학원 교습소 정보 저장(upsert). */
export async function POST(request: NextRequest) {
  const auth = await requireVipMenu(request, 'academy');
  if (auth instanceof NextResponse) return auth;
  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }); }

  const db = await getVipDb();
  await ensureAcademyIndexes(db);
  const uid = new ObjectId(auth.userId);

  const clean = sanitizeAcademy(body);
  await db.collection<VipAcademyInfo>(VIP_ACADEMY_COLLECTION).updateOne(
    { userId: uid },
    { $set: { ...clean, updatedAt: new Date() }, $setOnInsert: { userId: uid } },
    { upsert: true },
  );
  return NextResponse.json({ ok: true });
}
