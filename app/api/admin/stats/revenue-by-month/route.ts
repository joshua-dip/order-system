import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { effectiveOrderRevenueWon } from '@/lib/order-revenue';
import { revenueMonthKeyForOrder } from '@/lib/order-number';

/**
 * 완료 주문을 월별 합산. 주문번호 `XX-YYYYMMDD-NNN`의 연·월 우선, 없으면 completedAt(한국 월).
 */
export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get(COOKIE_NAME)?.value;
    if (!token) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }
    const payload = await verifyToken(token);
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: '관리자만 이용할 수 있습니다.' }, { status: 403 });
    }

    const monthsParam = request.nextUrl.searchParams.get('months');
    const limitMonths = Math.min(60, Math.max(1, parseInt(monthsParam || '36', 10) || 36));

    const db = await getDb('gomijoshua');
    const completed = await db
      .collection('orders')
      .find({ status: 'completed' })
      .project({ orderText: 1, revenueWon: 1, completedAt: 1, orderNumber: 1 })
      .toArray();

    const map = new Map<string, { totalWon: number; orderCount: number }>();
    for (const o of completed) {
      const key = revenueMonthKeyForOrder(o as { orderNumber?: unknown; completedAt?: unknown });
      if (key == null) continue;
      const amount = effectiveOrderRevenueWon(o as { revenueWon?: unknown; orderText?: unknown });
      const cur = map.get(key) ?? { totalWon: 0, orderCount: 0 };
      cur.totalWon += amount;
      cur.orderCount += 1;
      map.set(key, cur);
    }

    const sortedKeys = [...map.keys()].sort((a, b) => b.localeCompare(a));
    const sliced = sortedKeys.slice(0, limitMonths);

    const months = sliced.map((key) => {
      const row = map.get(key)!;
      const [y, m] = key.split('-');
      const label =
        y && m
          ? `${y}년 ${parseInt(m, 10)}월`
          : key;
      return {
        key,
        label,
        totalWon: row.totalWon,
        orderCount: row.orderCount,
      };
    });

    return NextResponse.json({
      months,
      note: '주문번호 날짜·completedAt 모두 없으면 월별에서 제외됩니다.',
    });
  } catch (err) {
    console.error('revenue-by-month:', err);
    return NextResponse.json({ error: '조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
