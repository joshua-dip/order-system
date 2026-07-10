import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVipMenu } from '@/lib/vip-menu-guard';
import { getDb } from '@/lib/mongodb';
import { col, type VipStudent } from '@/lib/vip-db';
import { GRAMMAR_WORKSHEETS_COLLECTION, type GrammarWorksheet, type WorksheetTarget } from '@/lib/vip-grammar-worksheet';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUSES = ['assigned', 'submitted', 'done'] as const;

/** GET — 학습지 1건(문항 스냅샷 포함, 소유자). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireVipMenu(request, 'grammar-problems');
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: 'id 오류' }, { status: 400 });
  const db = await getDb('gomijoshua');
  const w = await db.collection<GrammarWorksheet>(GRAMMAR_WORKSHEETS_COLLECTION)
    .findOne({ _id: new ObjectId(id), userId: new ObjectId(auth.userId) });
  if (!w) return NextResponse.json({ error: '학습지를 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({
    ok: true,
    worksheet: {
      id: String(w._id), title: w.title, topicKeys: w.topicKeys, category: w.category,
      itemCount: w.items.length, gradableCount: w.gradableCount, gradeToken: w.gradeToken,
      targets: w.targets.map((t) => ({ studentId: String(t.studentId), studentName: t.studentName, status: t.status })),
      createdAt: w.createdAt,
    },
  });
}

/**
 * PATCH ?  — 배정({ studentIds:[] }) | 이름변경({ title }) | 학생 상태({ studentId, status })
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireVipMenu(request, 'grammar-problems');
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: 'id 오류' }, { status: 400 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const db = await getDb('gomijoshua');
  const uid = new ObjectId(auth.userId);
  const filter = { _id: new ObjectId(id), userId: uid };

  // 1) 학생 배정 (targets 교체 — 기존 상태 유지)
  if (Array.isArray(body?.studentIds)) {
    const studentIds = (body!.studentIds as unknown[]).map(String).filter((x) => ObjectId.isValid(x));
    const students = await col<VipStudent>(db, 'students')
      .find({ userId: uid, _id: { $in: studentIds.map((s) => new ObjectId(s)) } }).project({ name: 1 }).toArray();
    const w = await db.collection<GrammarWorksheet>(GRAMMAR_WORKSHEETS_COLLECTION).findOne(filter, { projection: { targets: 1 } });
    if (!w) return NextResponse.json({ error: '학습지를 찾을 수 없습니다.' }, { status: 404 });
    const prev = new Map((w.targets ?? []).map((t) => [String(t.studentId), t]));
    const now = new Date();
    const targets: WorksheetTarget[] = students.map((s) => {
      const existing = prev.get(String(s._id));
      return existing ?? { studentId: s._id as ObjectId, studentName: String(s.name ?? ''), status: 'assigned', updatedAt: now };
    });
    await db.collection(GRAMMAR_WORKSHEETS_COLLECTION).updateOne(filter, { $set: { targets, updatedAt: now } });
    return NextResponse.json({ ok: true, assigned: targets.length });
  }

  // 2) 학생 개별 상태
  if (typeof body?.studentId === 'string' && ObjectId.isValid(body.studentId) && STATUSES.includes(body?.status as never)) {
    const r = await db.collection<GrammarWorksheet>(GRAMMAR_WORKSHEETS_COLLECTION).updateOne(
      { ...filter, 'targets.studentId': new ObjectId(body.studentId as string) },
      { $set: { 'targets.$.status': body.status, 'targets.$.updatedAt': new Date(), updatedAt: new Date() } },
    );
    if (!r.matchedCount) return NextResponse.json({ error: '대상 없음' }, { status: 404 });
    return NextResponse.json({ ok: true });
  }

  // 3) 이름 변경
  if (typeof body?.title === 'string' && body.title.trim()) {
    await db.collection(GRAMMAR_WORKSHEETS_COLLECTION).updateOne(filter, { $set: { title: body.title.trim().slice(0, 100), updatedAt: new Date() } });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: '변경할 내용이 없습니다.' }, { status: 400 });
}

/** DELETE — 학습지 삭제(소유자). */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireVipMenu(request, 'grammar-problems');
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: 'id 오류' }, { status: 400 });
  const db = await getDb('gomijoshua');
  const r = await db.collection(GRAMMAR_WORKSHEETS_COLLECTION).deleteOne({ _id: new ObjectId(id), userId: new ObjectId(auth.userId) });
  return NextResponse.json({ ok: true, deleted: r.deletedCount });
}
