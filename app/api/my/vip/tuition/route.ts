import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVipMenu } from '@/lib/vip-menu-guard';
import { getVipDb, ensureVipIndexes, col, type VipStudent } from '@/lib/vip-db';
import { VIP_TUITION_COLLECTION, ensureTuitionIndexes, isValidMonth, type VipTuitionInvoice } from '@/lib/vip-tuition-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function expectedTuition(s: VipStudent): number {
  return (s.subjects ?? []).reduce((sum, sub) => sum + (Number(sub.tuition) || 0), 0);
}

/** GET ?month=YYYY-MM — 활성 학생별 청구 현황(기본 청구액 = 과목 수강료 합) + 요약. */
export async function GET(request: NextRequest) {
  const auth = await requireVipMenu(request, 'tuition');
  if (auth instanceof NextResponse) return auth;
  const month = request.nextUrl.searchParams.get('month') || '';
  if (!isValidMonth(month)) return NextResponse.json({ error: 'month(YYYY-MM)가 필요합니다.' }, { status: 400 });

  const db = await getVipDb();
  await ensureVipIndexes(db); await ensureTuitionIndexes(db);
  const uid = new ObjectId(auth.userId);

  const students = await col<VipStudent>(db, 'students').find({ userId: uid, status: 'active' }).sort({ name: 1 }).toArray();
  const invoices = await db.collection<VipTuitionInvoice>(VIP_TUITION_COLLECTION).find({ userId: uid, month }).toArray();
  const invByStudent = new Map(invoices.map((iv) => [String(iv.studentId), iv]));

  const rows = students.map((s) => {
    const expected = expectedTuition(s);
    const iv = invByStudent.get(String(s._id));
    return {
      studentId: String(s._id),
      name: s.name,
      schoolName: s.schoolName ?? '',
      grade: s.grade ?? null,
      subjects: (s.subjects ?? []).map((x) => ({ name: x.name, tuition: Number(x.tuition) || 0 })),
      expected,
      amount: iv ? iv.amount : expected,
      status: iv ? iv.status : 'unpaid',
      paidAt: iv?.paidAt ?? null,
      hasInvoice: !!iv,
    };
  });

  const billed = rows.reduce((s, r) => s + r.amount, 0);
  const collected = rows.filter((r) => r.status === 'paid').reduce((s, r) => s + r.amount, 0);
  return NextResponse.json({
    ok: true, month, rows,
    summary: {
      studentCount: rows.length,
      billed,
      collected,
      outstanding: billed - collected,
      paidCount: rows.filter((r) => r.status === 'paid').length,
    },
  });
}

/** POST { month, studentId, amount?, status?, memo? } — 청구서 upsert(수납/금액 변경). */
export async function POST(request: NextRequest) {
  const auth = await requireVipMenu(request, 'tuition');
  if (auth instanceof NextResponse) return auth;
  let body: { month?: unknown; studentId?: unknown; amount?: unknown; status?: unknown; memo?: unknown };
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }); }

  const month = String(body.month ?? '');
  const studentIdRaw = String(body.studentId ?? '');
  if (!isValidMonth(month) || !ObjectId.isValid(studentIdRaw)) return NextResponse.json({ error: 'month·studentId가 올바르지 않습니다.' }, { status: 400 });

  const db = await getVipDb();
  await ensureTuitionIndexes(db);
  const uid = new ObjectId(auth.userId);
  const studentId = new ObjectId(studentIdRaw);

  const student = await col<VipStudent>(db, 'students').findOne({ _id: studentId, userId: uid });
  if (!student) return NextResponse.json({ error: '학생을 찾을 수 없습니다.' }, { status: 404 });

  const amount = body.amount !== undefined && Number.isFinite(Number(body.amount))
    ? Math.max(0, Math.floor(Number(body.amount)))
    : expectedTuition(student);
  const status: 'unpaid' | 'paid' = body.status === 'paid' ? 'paid' : 'unpaid';
  const memo = typeof body.memo === 'string' ? body.memo.slice(0, 100) : undefined;

  const now = new Date();
  await db.collection<VipTuitionInvoice>(VIP_TUITION_COLLECTION).updateOne(
    { userId: uid, studentId, month },
    {
      $set: { amount, status, paidAt: status === 'paid' ? now : null, ...(memo !== undefined ? { memo } : {}), updatedAt: now },
      $setOnInsert: { userId: uid, studentId, month, createdAt: now },
    },
    { upsert: true },
  );
  return NextResponse.json({ ok: true });
}
