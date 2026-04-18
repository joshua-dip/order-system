import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { POINT_LEDGER_COLLECTION } from '@/lib/point-ledger';

const KIND_LABELS: Record<string, string> = {
  order_spend: '주문 사용',
  admin_grant: '관리자 지급',
  admin_adjust: '관리자 조정',
  point_charge: '포인트 충전',
  member_variant_hard: '변형문제 생성',
  member_variant_refund: '변형문제 환급',
  order_cancel_refund: '주문 취소 환급',
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const token = request.cookies.get(COOKIE_NAME)?.value;
    if (!token) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }
    const payload = await verifyToken(token);
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: '관리자만 이용할 수 있습니다.' }, { status: 403 });
    }

    const { id } = await params;
    if (!id || !ObjectId.isValid(id)) {
      return NextResponse.json({ error: '유효하지 않은 ID입니다.' }, { status: 400 });
    }

    const url = new URL(request.url);
    const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') ?? '100', 10)));

    const db = await getDb('gomijoshua');
    const userId = new ObjectId(id);

    const docs = await db
      .collection(POINT_LEDGER_COLLECTION)
      .find({ userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    const items = docs.map((d) => ({
      id: (d._id as ObjectId).toString(),
      delta: typeof d.delta === 'number' ? d.delta : 0,
      balanceAfter: typeof d.balanceAfter === 'number' ? d.balanceAfter : 0,
      kind: typeof d.kind === 'string' ? d.kind : 'unknown',
      kindLabel: (typeof d.kind === 'string' ? KIND_LABELS[d.kind] : null) ?? d.kind ?? '기타',
      meta: d.meta && typeof d.meta === 'object' ? d.meta : {},
      createdAt: d.createdAt instanceof Date ? d.createdAt.toISOString() : (d.createdAt ?? null),
    }));

    return NextResponse.json({ items, total: items.length });
  } catch (err) {
    console.error('포인트 내역 조회 실패:', err);
    return NextResponse.json({ error: '조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
