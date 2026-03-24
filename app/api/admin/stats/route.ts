import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { isDropboxConfigured } from '@/lib/dropbox';
import { effectiveOrderRevenueWon, startOfKoreaMonth } from '@/lib/order-revenue';

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

    const db = await getDb('gomijoshua');
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    const [
      userOrderCounts,
      userLastOrderDates,
      newMembersThisMonth,
      newOrdersThisWeek,
      completedForRevenue,
    ] = await Promise.all([
      db.collection('orders').aggregate<{ _id: string; count: number }>([
        { $match: { loginId: { $exists: true, $ne: null } } },
        { $group: { _id: '$loginId', count: { $sum: 1 } } },
      ]).toArray(),
      db.collection('orders').aggregate<{ _id: string; lastAt: Date }>([
        { $match: { loginId: { $exists: true, $ne: null } } },
        { $sort: { createdAt: -1 } },
        { $group: { _id: '$loginId', lastAt: { $first: '$createdAt' } } },
      ]).toArray(),
      db.collection('users').countDocuments({ role: 'user', createdAt: { $gte: startOfMonth } }),
      db.collection('orders').countDocuments({ createdAt: { $gte: startOfWeek } }),
      db
        .collection('orders')
        .find({ status: 'completed' })
        .project({ orderText: 1, revenueWon: 1, completedAt: 1 })
        .toArray(),
    ]);

    const koreaMonthStart = startOfKoreaMonth(now);
    let revenueTotal = 0;
    let revenueThisMonth = 0;
    for (const o of completedForRevenue) {
      const amount = effectiveOrderRevenueWon(o);
      revenueTotal += amount;
      const ca = (o as { completedAt?: Date | string | null }).completedAt;
      if (ca != null) {
        const ref = ca instanceof Date ? ca : new Date(ca);
        if (!Number.isNaN(ref.getTime()) && ref >= koreaMonthStart) {
          revenueThisMonth += amount;
        }
      }
    }

    const orderCountByLoginId: Record<string, number> = {};
    userOrderCounts.forEach((row) => {
      orderCountByLoginId[row._id] = row.count;
    });

    const lastOrderDateByLoginId: Record<string, string> = {};
    userLastOrderDates.forEach((row) => {
      if (row.lastAt) lastOrderDateByLoginId[row._id] = typeof row.lastAt === 'string' ? row.lastAt : (row.lastAt as Date).toISOString();
    });

    return NextResponse.json({
      orderCountByLoginId,
      lastOrderDateByLoginId,
      newMembersThisMonth,
      newOrdersThisWeek,
      dropboxConfigured: isDropboxConfigured(),
      /** 완료 주문 기준 매출(원). 주문서 텍스트 파싱 + DB revenueWon */
      revenueTotal,
      /** completedAt이 이번 달(한국)인 완료 주문만 합산(구 데이터는 completedAt 없으면 이번 달 제외) */
      revenueThisMonth,
    });
  } catch (err) {
    console.error('관리자 통계 조회 실패:', err);
    return NextResponse.json(
      { error: '통계 조회 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
