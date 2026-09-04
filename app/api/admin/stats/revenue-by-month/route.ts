import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { effectiveOrderNetRevenueWon } from '@/lib/order-revenue';
import { revenueMonthKeyForOrder } from '@/lib/order-number';
import { loadMembershipRevenue } from '@/lib/membership-revenue';

/**
 * 완료 주문을 월별 합산. 주문번호 `XX-YYYYMMDD-NNN`의 연·월 우선, 없으면 completedAt(한국 월).
 *
 * 멤버십 결제(point_charge_orders)도 함께 센다 — orders 에 없어 매출에서 통째로
 * 빠져 있었다. 포인트 충전은 넣지 않는다(그 포인트로 결제한 주문이 이미 잡혀 이중 계상).
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
      .project({ orderText: 1, revenueWon: 1, pointsUsed: 1, orderMeta: 1, completedAt: 1, orderNumber: 1 })
      .toArray();

    const map = new Map<string, { totalWon: number; orderCount: number; membershipWon: number }>();

    /* 멤버십은 「완료 처리」 단계가 없다 — 결제되는 순간 이용이 시작되므로
       status='paid' 를 그대로 확정 매출로 본다. */
    for (const m of await loadMembershipRevenue(db)) {
      const cur = map.get(m.monthKey) ?? { totalWon: 0, orderCount: 0, membershipWon: 0 };
      cur.totalWon += m.amountWon;
      cur.membershipWon += m.amountWon;
      map.set(m.monthKey, cur);
    }

    for (const o of completed) {
      const key = revenueMonthKeyForOrder(o as { orderNumber?: unknown; completedAt?: unknown });
      if (key == null) continue;
      const amount = effectiveOrderNetRevenueWon(
        o as { revenueWon?: unknown; orderText?: unknown; orderMeta?: unknown; pointsUsed?: unknown }
      );
      const cur = map.get(key) ?? { totalWon: 0, orderCount: 0, membershipWon: 0 };
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
        /* 주문 매출과 구분해 볼 수 있게 별도로도 내려준다 */
        membershipWon: row.membershipWon,
      };
    });

    return NextResponse.json({
      months,
      note: '완료 주문 + 멤버십 결제(월·연회원)를 합산합니다. 포인트 충전은 그 포인트로 결제한 주문이 이미 잡혀 제외합니다. 주문번호 날짜·completedAt 모두 없는 주문은 월별에서 제외됩니다.',
    });
  } catch (err) {
    console.error('revenue-by-month:', err);
    return NextResponse.json({ error: '조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
