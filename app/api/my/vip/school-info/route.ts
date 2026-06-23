import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVipMenu } from '@/lib/vip-menu-guard';
import { getVipDb } from '@/lib/vip-db';
import {
  VIP_SCHOOL_INFO_COLLECTION,
  ensureSchoolInfoIndexes,
  isSchoolLevel,
  type VipSchoolInfo,
} from '@/lib/vip-school-info-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function view(s: VipSchoolInfo) {
  return {
    id: String(s._id),
    name: s.name,
    level: s.level,
    address: s.address ?? '',
    phone: s.phone ?? '',
    examInfo: s.examInfo ?? '',
    note: s.note ?? '',
    createdAt: s.createdAt,
  };
}

/** GET ?level= &q= — 학교 정보 목록. */
export async function GET(request: NextRequest) {
  const auth = await requireVipMenu(request, 'school-info');
  if (auth instanceof NextResponse) return auth;
  const db = await getVipDb();
  await ensureSchoolInfoIndexes(db);
  const uid = new ObjectId(auth.userId);

  const sp = request.nextUrl.searchParams;
  const filter: Record<string, unknown> = { userId: uid };
  const level = sp.get('level');
  if (isSchoolLevel(level)) filter.level = level;
  const q = (sp.get('q') || '').trim();
  if (q) filter.name = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };

  const list = await db.collection<VipSchoolInfo>(VIP_SCHOOL_INFO_COLLECTION)
    .find(filter).sort({ name: 1 }).limit(400).toArray();
  return NextResponse.json({ ok: true, schools: list.map(view) });
}

/** POST { name, level?, address?, phone?, examInfo?, note? } — 학교 추가. */
export async function POST(request: NextRequest) {
  const auth = await requireVipMenu(request, 'school-info');
  if (auth instanceof NextResponse) return auth;
  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }); }

  const name = (typeof body.name === 'string' ? body.name : '').trim().slice(0, 80);
  if (!name) return NextResponse.json({ error: '학교명을 입력하세요.' }, { status: 400 });

  const db = await getVipDb();
  await ensureSchoolInfoIndexes(db);
  const doc: VipSchoolInfo = {
    userId: new ObjectId(auth.userId),
    name,
    level: isSchoolLevel(body.level) ? body.level : '중등',
    address: typeof body.address === 'string' ? body.address.slice(0, 200) : '',
    phone: typeof body.phone === 'string' ? body.phone.slice(0, 40) : '',
    examInfo: typeof body.examInfo === 'string' ? body.examInfo.slice(0, 2000) : '',
    note: typeof body.note === 'string' ? body.note.slice(0, 500) : '',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const r = await db.collection(VIP_SCHOOL_INFO_COLLECTION).insertOne(doc);
  return NextResponse.json({ ok: true, id: String(r.insertedId) }, { status: 201 });
}

/** PATCH ?id= { name?, level?, address?, phone?, examInfo?, note? } */
export async function PATCH(request: NextRequest) {
  const auth = await requireVipMenu(request, 'school-info');
  if (auth instanceof NextResponse) return auth;
  const id = request.nextUrl.searchParams.get('id');
  if (!id || !ObjectId.isValid(id)) return NextResponse.json({ error: 'id 가 필요합니다.' }, { status: 400 });
  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }); }

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.name === 'string' && body.name.trim()) set.name = body.name.trim().slice(0, 80);
  if (isSchoolLevel(body.level)) set.level = body.level;
  if (typeof body.address === 'string') set.address = body.address.slice(0, 200);
  if (typeof body.phone === 'string') set.phone = body.phone.slice(0, 40);
  if (typeof body.examInfo === 'string') set.examInfo = body.examInfo.slice(0, 2000);
  if (typeof body.note === 'string') set.note = body.note.slice(0, 500);

  const db = await getVipDb();
  const uid = new ObjectId(auth.userId);
  const r = await db.collection(VIP_SCHOOL_INFO_COLLECTION).updateOne({ _id: new ObjectId(id), userId: uid }, { $set: set });
  if (r.matchedCount === 0) return NextResponse.json({ error: '학교를 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

/** DELETE ?id= */
export async function DELETE(request: NextRequest) {
  const auth = await requireVipMenu(request, 'school-info');
  if (auth instanceof NextResponse) return auth;
  const id = request.nextUrl.searchParams.get('id');
  if (!id || !ObjectId.isValid(id)) return NextResponse.json({ error: 'id 가 필요합니다.' }, { status: 400 });
  const db = await getVipDb();
  const uid = new ObjectId(auth.userId);
  const r = await db.collection(VIP_SCHOOL_INFO_COLLECTION).deleteOne({ _id: new ObjectId(id), userId: uid });
  return NextResponse.json({ ok: true, deleted: r.deletedCount });
}
