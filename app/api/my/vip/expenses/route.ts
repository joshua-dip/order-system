import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVipMenu } from '@/lib/vip-menu-guard';
import { getVipDb } from '@/lib/vip-db';
import {
  VIP_EXPENSES_COLLECTION,
  ensureExpenseIndexes,
  isExpenseCategory,
  type VipExpense,
} from '@/lib/vip-expense-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function view(e: VipExpense) {
  return {
    id: String(e._id),
    date: e.date,
    category: e.category,
    amount: e.amount,
    payee: e.payee,
    memo: e.memo,
    createdAt: e.createdAt,
  };
}

/** 'YYYY-MM' (현재 달). */
function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** GET ?month=YYYY-MM &category= — 지출 목록 + 요약(선택 달 합계/분류별). */
export async function GET(request: NextRequest) {
  const auth = await requireVipMenu(request, 'expenses');
  if (auth instanceof NextResponse) return auth;
  const db = await getVipDb();
  await ensureExpenseIndexes(db);
  const uid = new ObjectId(auth.userId);

  const sp = request.nextUrl.searchParams;
  const monthParam = sp.get('month');
  const month = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : currentMonth();

  const filter: Record<string, unknown> = { userId: uid, date: { $regex: '^' + month } };
  const category = sp.get('category');
  if (isExpenseCategory(category)) filter.category = category;

  const list = await db
    .collection<VipExpense>(VIP_EXPENSES_COLLECTION)
    .find(filter)
    .sort({ date: -1, createdAt: -1 })
    .limit(500)
    .toArray();

  // 요약 — 선택 달(필터 category 무시, 그 달 전체) 합계 + 분류별 합계
  const monthFilter: Record<string, unknown> = { userId: uid, date: { $regex: '^' + month } };
  const agg = await db
    .collection<VipExpense>(VIP_EXPENSES_COLLECTION)
    .aggregate<{ _id: string; total: number }>([
      { $match: monthFilter },
      { $group: { _id: '$category', total: { $sum: '$amount' } } },
    ])
    .toArray();
  const monthTotal = agg.reduce((s, r) => s + (r.total || 0), 0);
  const byCategory = agg
    .map((r) => ({ category: r._id, total: r.total || 0 }))
    .sort((a, b) => b.total - a.total);

  return NextResponse.json({ ok: true, records: list.map(view), summary: { month, monthTotal, byCategory } });
}

/** POST { date, category?, amount, payee?, memo? } — 지출 추가. */
export async function POST(request: NextRequest) {
  const auth = await requireVipMenu(request, 'expenses');
  if (auth instanceof NextResponse) return auth;
  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }); }

  const date = String(body.date ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: '날짜(YYYY-MM-DD)를 입력하세요.' }, { status: 400 });
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount < 0) return NextResponse.json({ error: '금액을 올바르게 입력하세요.' }, { status: 400 });
  const category = isExpenseCategory(body.category) ? body.category : '기타';
  const payee = (typeof body.payee === 'string' ? body.payee : '').trim().slice(0, 80);
  const memo = (typeof body.memo === 'string' ? body.memo : '').trim().slice(0, 500);

  const db = await getVipDb();
  await ensureExpenseIndexes(db);
  const uid = new ObjectId(auth.userId);

  const doc: VipExpense = {
    userId: uid,
    date,
    category,
    amount,
    payee,
    memo,
    createdAt: new Date(),
  };
  const r = await db.collection(VIP_EXPENSES_COLLECTION).insertOne(doc);
  return NextResponse.json({ ok: true, id: String(r.insertedId) }, { status: 201 });
}

/** PATCH ?id= { date?, category?, amount?, payee?, memo? } — 수정. */
export async function PATCH(request: NextRequest) {
  const auth = await requireVipMenu(request, 'expenses');
  if (auth instanceof NextResponse) return auth;
  const id = request.nextUrl.searchParams.get('id');
  if (!id || !ObjectId.isValid(id)) return NextResponse.json({ error: 'id 가 필요합니다.' }, { status: 400 });
  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }); }

  const set: Record<string, unknown> = {};
  if (typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date)) set.date = body.date;
  if (isExpenseCategory(body.category)) set.category = body.category;
  if (body.amount !== undefined) {
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount < 0) return NextResponse.json({ error: '금액을 올바르게 입력하세요.' }, { status: 400 });
    set.amount = amount;
  }
  if (typeof body.payee === 'string') set.payee = body.payee.trim().slice(0, 80);
  if (typeof body.memo === 'string') set.memo = body.memo.trim().slice(0, 500);

  const db = await getVipDb();
  const uid = new ObjectId(auth.userId);
  const r = await db.collection(VIP_EXPENSES_COLLECTION).updateOne({ _id: new ObjectId(id), userId: uid }, { $set: set });
  if (r.matchedCount === 0) return NextResponse.json({ error: '지출 내역을 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

/** DELETE ?id= */
export async function DELETE(request: NextRequest) {
  const auth = await requireVipMenu(request, 'expenses');
  if (auth instanceof NextResponse) return auth;
  const id = request.nextUrl.searchParams.get('id');
  if (!id || !ObjectId.isValid(id)) return NextResponse.json({ error: 'id 가 필요합니다.' }, { status: 400 });
  const db = await getVipDb();
  const uid = new ObjectId(auth.userId);
  const r = await db.collection(VIP_EXPENSES_COLLECTION).deleteOne({ _id: new ObjectId(id), userId: uid });
  return NextResponse.json({ ok: true, deleted: r.deletedCount });
}
