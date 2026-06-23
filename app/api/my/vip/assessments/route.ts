import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVipMenu } from '@/lib/vip-menu-guard';
import { getVipDb } from '@/lib/vip-db';
import {
  VIP_ASSESSMENTS_COLLECTION,
  ensureAssessmentIndexes,
  isAssessmentType,
  isAssessmentStatus,
  type VipAssessment,
} from '@/lib/vip-assessment-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function view(a: VipAssessment) {
  return {
    id: String(a._id),
    title: a.title,
    subject: a.subject ?? '',
    school: a.school ?? '',
    grade: a.grade ?? '',
    type: a.type,
    dueDate: a.dueDate ?? '',
    description: a.description ?? '',
    status: a.status,
    createdAt: a.createdAt,
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** GET ?status=예정|진행|완료 &q= — 수행평가 목록 + 요약(미완료 건수). */
export async function GET(request: NextRequest) {
  const auth = await requireVipMenu(request, 'assessments');
  if (auth instanceof NextResponse) return auth;
  const db = await getVipDb();
  await ensureAssessmentIndexes(db);
  const uid = new ObjectId(auth.userId);

  const sp = request.nextUrl.searchParams;
  const filter: Record<string, unknown> = { userId: uid };
  const status = sp.get('status');
  if (isAssessmentStatus(status)) filter.status = status;
  const q = (sp.get('q') ?? '').trim();
  if (q) {
    const rx = new RegExp(escapeRegExp(q), 'i');
    filter.$or = [{ title: rx }, { subject: rx }, { school: rx }];
  }

  const list = await db
    .collection<VipAssessment>(VIP_ASSESSMENTS_COLLECTION)
    .find(filter)
    .sort({ dueDate: 1, createdAt: -1 })
    .limit(400)
    .toArray();

  const upcoming = await db
    .collection(VIP_ASSESSMENTS_COLLECTION)
    .countDocuments({ userId: uid, status: { $ne: '완료' } });

  return NextResponse.json({ ok: true, records: list.map(view), summary: { upcoming } });
}

/** POST { title, subject?, school?, grade?, type?, dueDate?, description?, status? } — 수행평가 추가. */
export async function POST(request: NextRequest) {
  const auth = await requireVipMenu(request, 'assessments');
  if (auth instanceof NextResponse) return auth;
  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }); }

  const title = (typeof body.title === 'string' ? body.title : '').trim().slice(0, 160);
  if (!title) return NextResponse.json({ error: '제목을 입력하세요.' }, { status: 400 });
  const subject = (typeof body.subject === 'string' ? body.subject : '').trim().slice(0, 40);
  const school = (typeof body.school === 'string' ? body.school : '').trim().slice(0, 80);
  const grade = (typeof body.grade === 'string' ? body.grade : '').trim().slice(0, 20);
  const type = isAssessmentType(body.type) ? body.type : '기타';
  const dueDateRaw = typeof body.dueDate === 'string' ? body.dueDate.trim() : '';
  if (dueDateRaw !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(dueDateRaw)) {
    return NextResponse.json({ error: '마감일(YYYY-MM-DD)을 확인하세요.' }, { status: 400 });
  }
  const description = (typeof body.description === 'string' ? body.description : '').trim().slice(0, 2000);
  const status = isAssessmentStatus(body.status) ? body.status : '예정';

  const db = await getVipDb();
  await ensureAssessmentIndexes(db);
  const uid = new ObjectId(auth.userId);

  const doc: VipAssessment = {
    userId: uid,
    title,
    subject,
    school,
    grade,
    type,
    dueDate: dueDateRaw,
    description,
    status,
    createdAt: new Date(),
  };
  const r = await db.collection(VIP_ASSESSMENTS_COLLECTION).insertOne(doc);
  return NextResponse.json({ ok: true, id: String(r.insertedId) }, { status: 201 });
}

/** PATCH ?id= { title?, subject?, school?, grade?, type?, dueDate?, description?, status? } — 수정. */
export async function PATCH(request: NextRequest) {
  const auth = await requireVipMenu(request, 'assessments');
  if (auth instanceof NextResponse) return auth;
  const id = request.nextUrl.searchParams.get('id');
  if (!id || !ObjectId.isValid(id)) return NextResponse.json({ error: 'id 가 필요합니다.' }, { status: 400 });
  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }); }

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.title === 'string') {
    const t = body.title.trim().slice(0, 160);
    if (!t) return NextResponse.json({ error: '제목을 입력하세요.' }, { status: 400 });
    set.title = t;
  }
  if (typeof body.subject === 'string') set.subject = body.subject.trim().slice(0, 40);
  if (typeof body.school === 'string') set.school = body.school.trim().slice(0, 80);
  if (typeof body.grade === 'string') set.grade = body.grade.trim().slice(0, 20);
  if (isAssessmentType(body.type)) set.type = body.type;
  if (typeof body.dueDate === 'string') {
    const d = body.dueDate.trim();
    if (d !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return NextResponse.json({ error: '마감일(YYYY-MM-DD)을 확인하세요.' }, { status: 400 });
    set.dueDate = d;
  }
  if (typeof body.description === 'string') set.description = body.description.trim().slice(0, 2000);
  if (isAssessmentStatus(body.status)) set.status = body.status;

  const db = await getVipDb();
  const uid = new ObjectId(auth.userId);
  const r = await db.collection(VIP_ASSESSMENTS_COLLECTION).updateOne({ _id: new ObjectId(id), userId: uid }, { $set: set });
  if (r.matchedCount === 0) return NextResponse.json({ error: '수행평가를 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

/** DELETE ?id= */
export async function DELETE(request: NextRequest) {
  const auth = await requireVipMenu(request, 'assessments');
  if (auth instanceof NextResponse) return auth;
  const id = request.nextUrl.searchParams.get('id');
  if (!id || !ObjectId.isValid(id)) return NextResponse.json({ error: 'id 가 필요합니다.' }, { status: 400 });
  const db = await getVipDb();
  const uid = new ObjectId(auth.userId);
  const r = await db.collection(VIP_ASSESSMENTS_COLLECTION).deleteOne({ _id: new ObjectId(id), userId: uid });
  return NextResponse.json({ ok: true, deleted: r.deletedCount });
}
