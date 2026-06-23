import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVipMenu } from '@/lib/vip-menu-guard';
import { getVipDb, col, type VipStudent } from '@/lib/vip-db';
import {
  VIP_ASSIGNMENTS_COLLECTION,
  ensureAssignmentIndexes,
  isAssignmentStatus,
  type VipAssignment,
  type VipAssignmentTarget,
} from '@/lib/vip-assignment-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function progressOf(a: VipAssignment) {
  const total = a.targets.length;
  const done = a.targets.filter((t) => t.status === 'done').length;
  const submitted = a.targets.filter((t) => t.status === 'submitted').length;
  return { total, done, submitted, assigned: total - done - submitted };
}

function view(a: VipAssignment) {
  return {
    id: String(a._id),
    title: a.title,
    questionCount: a.questionIds.length,
    questionIds: a.questionIds.map(String),
    dueDate: a.dueDate ?? null,
    memo: a.memo ?? '',
    createdAt: a.createdAt,
    progress: progressOf(a),
    targets: a.targets.map((t) => ({ studentId: String(t.studentId), studentName: t.studentName, status: t.status })),
  };
}

/** GET — 내 숙제 목록(진행 요약 포함). */
export async function GET(request: NextRequest) {
  const auth = await requireVipMenu(request, 'homework');
  if (auth instanceof NextResponse) return auth;
  const db = await getVipDb();
  await ensureAssignmentIndexes(db);
  const uid = new ObjectId(auth.userId);
  const list = await db.collection<VipAssignment>(VIP_ASSIGNMENTS_COLLECTION).find({ userId: uid }).sort({ createdAt: -1 }).limit(200).toArray();
  return NextResponse.json({ ok: true, assignments: list.map(view) });
}

/** POST — 숙제 생성 ({ title, questionIds[], studentIds[], dueDate?, memo? }). */
export async function POST(request: NextRequest) {
  const auth = await requireVipMenu(request, 'homework');
  if (auth instanceof NextResponse) return auth;
  let body: { title?: unknown; questionIds?: unknown; studentIds?: unknown; dueDate?: unknown; memo?: unknown };
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }); }

  const title = (typeof body.title === 'string' ? body.title : '').trim().slice(0, 80);
  const questionIds = Array.isArray(body.questionIds) ? body.questionIds.map(String).filter((x) => ObjectId.isValid(x)) : [];
  const studentIds = Array.isArray(body.studentIds) ? body.studentIds.map(String).filter((x) => ObjectId.isValid(x)) : [];
  if (!title) return NextResponse.json({ error: '숙제 제목을 입력하세요.' }, { status: 400 });
  if (questionIds.length === 0) return NextResponse.json({ error: '문항을 1개 이상 선택하세요.' }, { status: 400 });
  if (studentIds.length === 0) return NextResponse.json({ error: '배정할 학생을 1명 이상 선택하세요.' }, { status: 400 });
  const dueDate = typeof body.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.dueDate) ? body.dueDate : null;
  const memo = typeof body.memo === 'string' ? body.memo.slice(0, 200) : undefined;

  const db = await getVipDb();
  await ensureAssignmentIndexes(db);
  const uid = new ObjectId(auth.userId);

  // 내 학생만, 이름 조회
  const students = await col<VipStudent>(db, 'students')
    .find({ userId: uid, _id: { $in: studentIds.map((id) => new ObjectId(id)) } })
    .project({ name: 1 }).toArray();
  if (students.length === 0) return NextResponse.json({ error: '배정할 학생을 찾을 수 없습니다.' }, { status: 400 });

  const now = new Date();
  const targets: VipAssignmentTarget[] = students.map((s) => ({ studentId: s._id as ObjectId, studentName: String(s.name ?? ''), status: 'assigned', updatedAt: now }));
  const doc: VipAssignment = {
    userId: uid, title, questionIds: questionIds.map((id) => new ObjectId(id)), targets, dueDate, ...(memo !== undefined ? { memo } : {}), createdAt: now,
  };
  const r = await db.collection(VIP_ASSIGNMENTS_COLLECTION).insertOne(doc);
  return NextResponse.json({ ok: true, id: String(r.insertedId) }, { status: 201 });
}

/** PATCH ?id= — 학생 진행상태 변경({ studentId, status }) 또는 메타 수정({ title?, dueDate? }). */
export async function PATCH(request: NextRequest) {
  const auth = await requireVipMenu(request, 'homework');
  if (auth instanceof NextResponse) return auth;
  const id = request.nextUrl.searchParams.get('id');
  if (!id || !ObjectId.isValid(id)) return NextResponse.json({ error: 'id 가 필요합니다.' }, { status: 400 });
  let body: { studentId?: unknown; status?: unknown; title?: unknown; dueDate?: unknown };
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }); }

  const db = await getVipDb();
  const uid = new ObjectId(auth.userId);
  const filter = { _id: new ObjectId(id), userId: uid };

  if (typeof body.studentId === 'string' && ObjectId.isValid(body.studentId) && isAssignmentStatus(body.status)) {
    const r = await db.collection<VipAssignment>(VIP_ASSIGNMENTS_COLLECTION).updateOne(
      { ...filter, 'targets.studentId': new ObjectId(body.studentId) },
      { $set: { 'targets.$.status': body.status, 'targets.$.updatedAt': new Date(), updatedAt: new Date() } },
    );
    if (r.matchedCount === 0) return NextResponse.json({ error: '대상을 찾을 수 없습니다.' }, { status: 404 });
    return NextResponse.json({ ok: true });
  }

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.title === 'string' && body.title.trim()) set.title = body.title.trim().slice(0, 80);
  if (typeof body.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.dueDate)) set.dueDate = body.dueDate;
  const r = await db.collection(VIP_ASSIGNMENTS_COLLECTION).updateOne(filter, { $set: set });
  if (r.matchedCount === 0) return NextResponse.json({ error: '숙제를 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

/** DELETE ?id= */
export async function DELETE(request: NextRequest) {
  const auth = await requireVipMenu(request, 'homework');
  if (auth instanceof NextResponse) return auth;
  const id = request.nextUrl.searchParams.get('id');
  if (!id || !ObjectId.isValid(id)) return NextResponse.json({ error: 'id 가 필요합니다.' }, { status: 400 });
  const db = await getVipDb();
  const uid = new ObjectId(auth.userId);
  const r = await db.collection(VIP_ASSIGNMENTS_COLLECTION).deleteOne({ _id: new ObjectId(id), userId: uid });
  return NextResponse.json({ ok: true, deleted: r.deletedCount });
}
