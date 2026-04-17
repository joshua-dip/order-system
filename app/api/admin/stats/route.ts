import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { isDropboxConfigured } from '@/lib/dropbox';
import { effectiveOrderRevenueWon } from '@/lib/order-revenue';
import { koreaDateKey, koreaYearMonthKey } from '@/lib/korea-date-key';
import { revenueMonthKeyForOrder } from '@/lib/order-number';

type SiteStatsDaily = {
  _id: string;
  pageViews?: number;
  uniqueVisitors?: number;
};

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

    const todayKey = koreaDateKey(now);
    const [
      userLastOrderDates,
      newMembersThisMonth,
      newOrdersThisWeek,
      completedForRevenue,
      siteToday,
    ] = await Promise.all([
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
        .project({ orderText: 1, revenueWon: 1, orderMeta: 1, completedAt: 1, orderNumber: 1, loginId: 1 })
        .toArray(),
      db.collection<SiteStatsDaily>('site_stats_daily').findOne({ _id: todayKey }),
    ]);

    const thisYearMonth = koreaYearMonthKey(now);
    let revenueTotal = 0;
    let revenueThisMonth = 0;
    /** 완료 주문만, 회원 loginId 기준 건수·매출(원) */
    const orderCountByLoginId: Record<string, number> = {};
    const revenueByLoginId: Record<string, number> = {};
    for (const o of completedForRevenue) {
      const amount = effectiveOrderRevenueWon(o);
      revenueTotal += amount;
      const monthKey = revenueMonthKeyForOrder(o as { orderNumber?: unknown; completedAt?: unknown });
      if (monthKey === thisYearMonth) {
        revenueThisMonth += amount;
      }
      const lid = (o as { loginId?: string | null }).loginId;
      if (!lid || typeof lid !== 'string') continue;
      orderCountByLoginId[lid] = (orderCountByLoginId[lid] ?? 0) + 1;
      revenueByLoginId[lid] = (revenueByLoginId[lid] ?? 0) + amount;
    }

    const lastOrderDateByLoginId: Record<string, string> = {};
    userLastOrderDates.forEach((row) => {
      if (row.lastAt) lastOrderDateByLoginId[row._id] = typeof row.lastAt === 'string' ? row.lastAt : (row.lastAt as Date).toISOString();
    });

    const pv = typeof siteToday?.pageViews === 'number' ? siteToday.pageViews : 0;
    const uv = typeof siteToday?.uniqueVisitors === 'number' ? siteToday.uniqueVisitors : 0;

    return NextResponse.json({
      /** status=completed 주문만 loginId별 건수 */
      orderCountByLoginId,
      /** status=completed 주문만 loginId별 매출(원) 합계 */
      revenueByLoginId,
      lastOrderDateByLoginId,
      newMembersThisMonth,
      newOrdersThisWeek,
      /** 한국 날짜 기준 오늘 공개 페이지 조회(라우트 전환마다 1회 가까이) */
      siteVisitsTodayPageViews: pv,
      /** 쿠키 기준 당일 첫 방문만 1명으로 집계(추정 순방문) */
      siteVisitsTodayUnique: uv,
      siteVisitsTodayKey: todayKey,
      dropboxConfigured: isDropboxConfigured(),
      /** 완료 주문 기준 매출(원). 주문서 텍스트 파싱 + DB revenueWon */
      revenueTotal,
      /** 완료 주문: 주문번호 중간 YYYYMMDD의 연·월이 이번 달(한국 달력과 동일 YYYY-MM 비교)이면 합산. 번호 없으면 completedAt(한국 월) */
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
