import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { POINT_LEDGER_COLLECTION, type PointLedgerKind } from '@/lib/point-ledger';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;

export async function GET(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }
  const payload = await verifyToken(token);
  if (!payload?.sub) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  let userId: ObjectId;
  try {
    userId = new ObjectId(payload.sub);
  } catch {
    return NextResponse.json({ error: '잘못된 계정입니다.' }, { status: 400 });
  }

  const rawLimit = request.nextUrl.searchParams.get('limit');
  let limit = DEFAULT_LIMIT;
  if (rawLimit) {
    const n = parseInt(rawLimit, 10);
    if (Number.isFinite(n) && n > 0) limit = Math.min(n, MAX_LIMIT);
  }

  try {
    const db = await getDb('gomijoshua');
    const docs = await db
      .collection(POINT_LEDGER_COLLECTION)
      .find({ userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .project({ userId: 0 })
      .toArray();

    const entries = docs.map((d) => ({
      id: d._id.toString(),
      createdAt: d.createdAt instanceof Date ? d.createdAt.toISOString() : '',
      delta: typeof d.delta === 'number' ? d.delta : 0,
      balanceAfter: typeof d.balanceAfter === 'number' ? d.balanceAfter : 0,
      kind: (typeof d.kind === 'string' ? d.kind : 'admin_adjust') as PointLedgerKind,
      meta: d.meta && typeof d.meta === 'object' && !Array.isArray(d.meta) ? d.meta : {},
    }));

    return NextResponse.json({ entries });
  } catch (e) {
    console.error('point-history GET:', e);
    return NextResponse.json({ error: '조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
