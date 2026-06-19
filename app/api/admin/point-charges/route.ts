import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/lib/mongodb';
import { POINT_LEDGER_COLLECTION } from '@/lib/point-ledger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 관리자 — 전 회원 포인트 구매(충전) 내역.
 * point_ledger 의 kind='point_charge'(토스 결제 충전)만 모아 회원 정보와 함께 반환.
 * query: page, limit, q(회원 이름/아이디), from, to (YYYY-MM-DD)
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const sp = request.nextUrl.searchParams;
  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(sp.get('limit') ?? '50', 10) || 50));
  const q = (sp.get('q') ?? '').trim();
  const from = (sp.get('from') ?? '').trim();
  const to = (sp.get('to') ?? '').trim();

  const db = await getDb('gomijoshua');

  const filter: Record<string, unknown> = { kind: 'point_charge' };
  const dateCond: Record<string, Date> = {};
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) dateCond.$gte = new Date(`${from}T00:00:00`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) dateCond.$lte = new Date(`${to}T23:59:59.999`);
  if (Object.keys(dateCond).length) filter.createdAt = dateCond;

  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    const matched = await db
      .collection('users')
      .find({ $or: [{ name: rx }, { loginId: rx }] })
      .project({ _id: 1 })
      .limit(1000)
      .toArray();
    filter.userId = { $in: matched.map((u) => u._id) };
  }

  const ledger = db.collection(POINT_LEDGER_COLLECTION);
  const total = await ledger.countDocuments(filter);
  const docs = await ledger
    .find(filter)
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .toArray();

  const userIds = [...new Set(docs.map((d) => String(d.userId)))].filter((s) => ObjectId.isValid(s));
  const users = userIds.length
    ? await db
        .collection('users')
        .find({ _id: { $in: userIds.map((s) => new ObjectId(s)) } })
        .project({ name: 1, loginId: 1 })
        .toArray()
    : [];
  const userMap = new Map(users.map((u) => [String(u._id), u as { name?: string; loginId?: string }]));

  const items = docs.map((d) => {
    const meta = (d.meta && typeof d.meta === 'object' ? d.meta : {}) as Record<string, unknown>;
    const u = userMap.get(String(d.userId));
    return {
      id: String(d._id),
      userId: String(d.userId),
      name: u?.name ?? '',
      loginId: u?.loginId ?? '',
      points: typeof d.delta === 'number' ? d.delta : 0,
      balanceAfter: typeof d.balanceAfter === 'number' ? d.balanceAfter : null,
      amountWon: typeof meta.amountWon === 'number' ? meta.amountWon : null,
      orderId: typeof meta.orderId === 'string' ? meta.orderId : '',
      couponDiscountPct: typeof meta.couponDiscountPct === 'number' ? meta.couponDiscountPct : null,
      createdAt: d.createdAt instanceof Date ? d.createdAt.toISOString() : (d.createdAt ?? null),
    };
  });

  const [agg] = await ledger
    .aggregate([
      { $match: filter },
      { $group: { _id: null, count: { $sum: 1 }, points: { $sum: '$delta' }, amount: { $sum: '$meta.amountWon' } } },
    ])
    .toArray();

  return NextResponse.json({
    ok: true,
    items,
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    summary: {
      count: agg?.count ?? 0,
      points: agg?.points ?? 0,
      amount: agg?.amount ?? 0,
    },
  });
}
