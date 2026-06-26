import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVipMenu } from '@/lib/vip-menu-guard';
import { getVipDb, col, type VipStudent } from '@/lib/vip-db';
import {
  VIP_ADMISSIONS_COLLECTION,
  ensureAdmissionIndexes,
  isAdmissionTrack,
  isAdmissionStatus,
  type VipAdmission,
} from '@/lib/vip-admission-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function view(a: VipAdmission) {
  return {
    id: String(a._id),
    studentId: String(a.studentId),
    studentName: a.studentName,
    university: a.university,
    department: a.department,
    track: a.track,
    status: a.status,
    targetDate: a.targetDate,
    memo: a.memo,
    createdAt: a.createdAt,
  };
}

/** GET ?studentId= &status= — 입시 목록(마감 가까운 순) + 요약(진행 중). */
export async function GET(request: NextRequest) {
  const auth = await requireVipMenu(request, 'admissions');
  if (auth instanceof NextResponse) return auth;
  const db = await getVipDb();
  await ensureAdmissionIndexes(db);
  const uid = new ObjectId(auth.userId);

  const sp = request.nextUrl.searchParams;
  const filter: Record<string, unknown> = { userId: uid };
  const sid = sp.get('studentId');
  if (sid && ObjectId.isValid(sid)) filter.studentId = new ObjectId(sid);
  const status = sp.get('status');
  if (isAdmissionStatus(status)) filter.status = status;

  const list = await db
    .collection<VipAdmission>(VIP_ADMISSIONS_COLLECTION)
    .find(filter)
    .sort({ targetDate: 1, createdAt: -1 })
    .limit(400)
    .toArray();

  // 요약 — 진행 중(최종합격/불합격/등록 제외) 건수
  const inProgress = await db
    .collection(VIP_ADMISSIONS_COLLECTION)
    .countDocuments({ userId: uid, status: { $nin: ['최종합격', '불합격', '등록'] } });

  return NextResponse.json({ ok: true, records: list.map(view), summary: { inProgress } });
}

/** POST { studentId, university, department, track?, status?, targetDate?, memo? } — 입시 추가. */
export async function POST(request: NextRequest) {
  const auth = await requireVipMenu(request, 'admissions');
  if (auth instanceof NextResponse) return auth;
  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }); }

  const studentIdRaw = String(body.studentId ?? '');
  if (!ObjectId.isValid(studentIdRaw)) return NextResponse.json({ error: '학생을 선택하세요.' }, { status: 400 });
  const university = (typeof body.university === 'string' ? body.university : '').trim().slice(0, 80);
  if (!university) return NextResponse.json({ error: '대학을 입력하세요.' }, { status: 400 });
  const department = (typeof body.department === 'string' ? body.department : '').trim().slice(0, 80);
  const track = isAdmissionTrack(body.track) ? body.track : '수시-학종';
  const status = isAdmissionStatus(body.status) ? body.status : '준비';
  const targetDateRaw = String(body.targetDate ?? '');
  const targetDate = /^\d{4}-\d{2}-\d{2}$/.test(targetDateRaw) ? targetDateRaw : '';
  const memo = (typeof body.memo === 'string' ? body.memo : '').trim().slice(0, 1000);

  const db = await getVipDb();
  await ensureAdmissionIndexes(db);
  const uid = new ObjectId(auth.userId);
  const student = await col<VipStudent>(db, 'students').findOne({ _id: new ObjectId(studentIdRaw), userId: uid });
  if (!student) return NextResponse.json({ error: '학생을 찾을 수 없습니다.' }, { status: 404 });

  const doc: VipAdmission = {
    userId: uid,
    studentId: student._id as ObjectId,
    studentName: String(student.name ?? ''),
    university,
    department,
    track,
    status,
    targetDate,
    memo,
    createdAt: new Date(),
  };
  const r = await db.collection(VIP_ADMISSIONS_COLLECTION).insertOne(doc);
  return NextResponse.json({ ok: true, id: String(r.insertedId) }, { status: 201 });
}

/** PATCH ?id= { university?, department?, track?, status?, targetDate?, memo? } — 수정. */
export async function PATCH(request: NextRequest) {
  const auth = await requireVipMenu(request, 'admissions');
  if (auth instanceof NextResponse) return auth;
  const id = request.nextUrl.searchParams.get('id');
  if (!id || !ObjectId.isValid(id)) return NextResponse.json({ error: 'id 가 필요합니다.' }, { status: 400 });
  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }); }

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.university === 'string') set.university = body.university.trim().slice(0, 80);
  if (typeof body.department === 'string') set.department = body.department.trim().slice(0, 80);
  if (isAdmissionTrack(body.track)) set.track = body.track;
  if (isAdmissionStatus(body.status)) set.status = body.status;
  if (typeof body.targetDate === 'string') set.targetDate = /^\d{4}-\d{2}-\d{2}$/.test(body.targetDate) ? body.targetDate : '';
  if (typeof body.memo === 'string') set.memo = body.memo.trim().slice(0, 1000);

  const db = await getVipDb();
  const uid = new ObjectId(auth.userId);
  const r = await db.collection(VIP_ADMISSIONS_COLLECTION).updateOne({ _id: new ObjectId(id), userId: uid }, { $set: set });
  if (r.matchedCount === 0) return NextResponse.json({ error: '기록을 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

/** DELETE ?id= */
export async function DELETE(request: NextRequest) {
  const auth = await requireVipMenu(request, 'admissions');
  if (auth instanceof NextResponse) return auth;
  const id = request.nextUrl.searchParams.get('id');
  if (!id || !ObjectId.isValid(id)) return NextResponse.json({ error: 'id 가 필요합니다.' }, { status: 400 });
  const db = await getVipDb();
  const uid = new ObjectId(auth.userId);
  const r = await db.collection(VIP_ADMISSIONS_COLLECTION).deleteOne({ _id: new ObjectId(id), userId: uid });
  return NextResponse.json({ ok: true, deleted: r.deletedCount });
}
