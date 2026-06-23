import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVipMenu } from '@/lib/vip-menu-guard';
import { getVipDb } from '@/lib/vip-db';
import {
  VIP_PAYROLL_COLLECTION,
  ensurePayrollIndexes,
  netPay,
  type VipPayroll,
} from '@/lib/vip-payroll-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function view(p: VipPayroll) {
  return {
    id: String(p._id),
    name: p.name,
    role: p.role,
    month: p.month,
    baseSalary: p.baseSalary,
    bonus: p.bonus,
    deduction: p.deduction,
    paid: p.paid,
    payDate: p.payDate,
    memo: p.memo,
    createdAt: p.createdAt,
    net: netPay(p),
  };
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** GET ?month=YYYY-MM — 급여 목록 + 해당 월 요약. */
export async function GET(request: NextRequest) {
  const auth = await requireVipMenu(request, 'payroll');
  if (auth instanceof NextResponse) return auth;
  const db = await getVipDb();
  await ensurePayrollIndexes(db);
  const uid = new ObjectId(auth.userId);

  const sp = request.nextUrl.searchParams;
  const monthParam = sp.get('month');
  const month = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : '';

  const filter: Record<string, unknown> = { userId: uid };
  if (month) filter.month = month;
  const list = await db
    .collection<VipPayroll>(VIP_PAYROLL_COLLECTION)
    .find(filter)
    .sort({ month: -1, name: 1 })
    .limit(500)
    .toArray();

  // 요약 — 필터된 월(없으면 이번 달) 기준.
  const summaryMonth = month || currentMonth();
  const monthDocs = await db
    .collection<VipPayroll>(VIP_PAYROLL_COLLECTION)
    .find({ userId: uid, month: summaryMonth })
    .toArray();
  let totalNet = 0;
  let paidCount = 0;
  let unpaidCount = 0;
  for (const p of monthDocs) {
    totalNet += netPay(p);
    if (p.paid) paidCount += 1;
    else unpaidCount += 1;
  }
  const summary = { month: summaryMonth, totalNet, paidCount, unpaidCount, headcount: monthDocs.length };

  return NextResponse.json({ ok: true, records: list.map(view), summary });
}

/** POST { name, role?, month, baseSalary?, bonus?, deduction?, paid?, payDate?, memo? } — 급여 추가. */
export async function POST(request: NextRequest) {
  const auth = await requireVipMenu(request, 'payroll');
  if (auth instanceof NextResponse) return auth;
  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }); }

  const name = (typeof body.name === 'string' ? body.name : '').trim().slice(0, 60);
  const month = String(body.month ?? '');
  if (!name) return NextResponse.json({ error: '이름을 입력하세요.' }, { status: 400 });
  if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: '급여 월(YYYY-MM)을 입력하세요.' }, { status: 400 });

  const role = (typeof body.role === 'string' ? body.role : '').trim().slice(0, 40);
  const num = (v: unknown) => Math.max(0, Math.floor(Number(v) || 0));
  const baseSalary = num(body.baseSalary);
  const bonus = num(body.bonus);
  const deduction = num(body.deduction);
  const paid = body.paid === true;
  const payDate = typeof body.payDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.payDate) ? body.payDate : '';
  const memo = (typeof body.memo === 'string' ? body.memo : '').slice(0, 500);

  const db = await getVipDb();
  await ensurePayrollIndexes(db);
  const uid = new ObjectId(auth.userId);

  const now = new Date();
  const doc: VipPayroll = {
    userId: uid, name, role, month,
    baseSalary, bonus, deduction, paid, payDate, memo,
    createdAt: now, updatedAt: now,
  };
  const r = await db.collection(VIP_PAYROLL_COLLECTION).insertOne(doc);
  return NextResponse.json({ ok: true, id: String(r.insertedId) }, { status: 201 });
}

/** PATCH ?id= { name?, role?, month?, baseSalary?, bonus?, deduction?, paid?, payDate?, memo? } — 수정. */
export async function PATCH(request: NextRequest) {
  const auth = await requireVipMenu(request, 'payroll');
  if (auth instanceof NextResponse) return auth;
  const id = request.nextUrl.searchParams.get('id');
  if (!id || !ObjectId.isValid(id)) return NextResponse.json({ error: 'id 가 필요합니다.' }, { status: 400 });
  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }); }

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.name === 'string') set.name = body.name.trim().slice(0, 60);
  if (typeof body.role === 'string') set.role = body.role.trim().slice(0, 40);
  if (typeof body.month === 'string' && /^\d{4}-\d{2}$/.test(body.month)) set.month = body.month;
  if (body.baseSalary !== undefined) set.baseSalary = Math.max(0, Math.floor(Number(body.baseSalary) || 0));
  if (body.bonus !== undefined) set.bonus = Math.max(0, Math.floor(Number(body.bonus) || 0));
  if (body.deduction !== undefined) set.deduction = Math.max(0, Math.floor(Number(body.deduction) || 0));
  if (typeof body.paid === 'boolean') set.paid = body.paid;
  if (typeof body.payDate === 'string' && (body.payDate === '' || /^\d{4}-\d{2}-\d{2}$/.test(body.payDate))) set.payDate = body.payDate;
  if (typeof body.memo === 'string') set.memo = body.memo.slice(0, 500);

  const db = await getVipDb();
  const uid = new ObjectId(auth.userId);
  const r = await db.collection(VIP_PAYROLL_COLLECTION).updateOne({ _id: new ObjectId(id), userId: uid }, { $set: set });
  if (r.matchedCount === 0) return NextResponse.json({ error: '기록을 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

/** DELETE ?id= */
export async function DELETE(request: NextRequest) {
  const auth = await requireVipMenu(request, 'payroll');
  if (auth instanceof NextResponse) return auth;
  const id = request.nextUrl.searchParams.get('id');
  if (!id || !ObjectId.isValid(id)) return NextResponse.json({ error: 'id 가 필요합니다.' }, { status: 400 });
  const db = await getVipDb();
  const uid = new ObjectId(auth.userId);
  const r = await db.collection(VIP_PAYROLL_COLLECTION).deleteOne({ _id: new ObjectId(id), userId: uid });
  return NextResponse.json({ ok: true, deleted: r.deletedCount });
}
