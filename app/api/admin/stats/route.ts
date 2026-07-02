import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { isDropboxConfigured } from '@/lib/dropbox';
import { effectiveOrderNetRevenueWon } from '@/lib/order-revenue';
import { koreaDateKey, koreaYearMonthKey } from '@/lib/korea-date-key';
import { revenueMonthKeyForOrder } from '@/lib/order-number';
import { POINT_LEDGER_COLLECTION } from '@/lib/point-ledger';

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
      pointCharges,
    ] = await Promise.all([
      db.collection('orders').aggregate<{ _id: string; lastAt: Date }>([
        { $match: { loginId: { $exists: true, $ne: null } } },
        { $sort: { createdAt: -1 } },
        { $group: { _id: '$loginId', lastAt: { $first: '$createdAt' } } },
      ]).toArray(),
      db.collection('users').countDocuments({ role: 'user', createdAt: { $gte: startOfMonth } }),
      db.collection('orders').countDocuments({ createdAt: { $gte: startOfWeek } }),
      // 완료 주문 — orderText(주문서 전문)는 실제로 필요한 건(revenueWon 미저장 또는 포인트 사용)만 포함해
      // 페이로드·조회 시간을 줄인다 (대시보드 로딩 최적화).
      Promise.all([
        db
          .collection('orders')
          .find({ status: 'completed', $or: [{ revenueWon: null }, { revenueWon: { $exists: false } }, { pointsUsed: { $gt: 0 } }] })
          .project({ orderText: 1, revenueWon: 1, pointsUsed: 1, orderMeta: 1, completedAt: 1, orderNumber: 1, loginId: 1 })
          .toArray(),
        db
          .collection('orders')
          // 위 A 쿼리의 정확한 여집합: revenueWon 저장됨 AND NOT(pointsUsed>0) — null·0·미존재 모두 포함
          .find({ status: 'completed', revenueWon: { $ne: null }, pointsUsed: { $not: { $gt: 0 } } })
          .project({ revenueWon: 1, pointsUsed: 1, orderMeta: 1, completedAt: 1, orderNumber: 1, loginId: 1 })
          .toArray(),
      ]).then(([a, b]) => [...a, ...b]),
      db.collection<SiteStatsDaily>('site_stats_daily').findOne({ _id: todayKey }),
      db
        .collection(POINT_LEDGER_COLLECTION)
        .find({ kind: 'point_charge' })
        .project({ createdAt: 1, delta: 1, meta: 1 })
        .toArray(),
    ]);

    const thisYearMonth = koreaYearMonthKey(now);
    let revenueTotal = 0;
    let revenueThisMonth = 0;
    /** 완료 주문만, 회원 loginId 기준 건수·매출(원) */
    const orderCountByLoginId: Record<string, number> = {};
    const revenueByLoginId: Record<string, number> = {};
    for (const o of completedForRevenue) {
      // 주문 매출은 실입금(현금)만 — 사용 포인트는 포인트충전 매출로 이미 잡혔으므로 제외.
      const amount = effectiveOrderNetRevenueWon(o);
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

    /** 포인트 충전(토스 결제) 매출 — point_ledger kind=point_charge 의 meta.amountWon 합 */
    let pointRevenueTotal = 0;
    let pointRevenueThisMonth = 0;
    for (const p of pointCharges) {
      const meta = (p as { meta?: { amountWon?: unknown } }).meta;
      const amountWon = meta && typeof meta.amountWon === 'number' ? meta.amountWon : 0;
      if (!amountWon) continue;
      pointRevenueTotal += amountWon;
      const created = (p as { createdAt?: unknown }).createdAt;
      const createdDate =
        created instanceof Date ? created : typeof created === 'string' ? new Date(created) : null;
      if (createdDate && !Number.isNaN(createdDate.getTime()) && koreaYearMonthKey(createdDate) === thisYearMonth) {
        pointRevenueThisMonth += amountWon;
      }
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
      /** 포인트 충전(토스 결제) 누적 매출(원) */
      pointRevenueTotal,
      /** 이번 달(한국 createdAt 기준) 포인트 충전 매출(원) */
      pointRevenueThisMonth,
    });
  } catch (err) {
    console.error('관리자 통계 조회 실패:', err);
    return NextResponse.json(
      { error: '통계 조회 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
