import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';

type SiteStatsDaily = {
  _id: string;
  pageViews?: number;
  uniqueVisitors?: number;
};

/**
 * site_stats_daily 일별 집계(한국 날짜 키 _id = YYYY-MM-DD). 최신순.
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

    const daysParam = request.nextUrl.searchParams.get('days');
    const limitDays = Math.min(400, Math.max(1, parseInt(daysParam || '120', 10) || 120));

    const db = await getDb('gomijoshua');
    const docs = await db
      .collection<SiteStatsDaily>('site_stats_daily')
      .find({})
      .sort({ _id: -1 })
      .limit(limitDays)
      .toArray();

    const days = docs.map((d) => ({
      date: String(d._id),
      pageViews: typeof d.pageViews === 'number' && Number.isFinite(d.pageViews) ? d.pageViews : 0,
      uniqueVisitors:
        typeof d.uniqueVisitors === 'number' && Number.isFinite(d.uniqueVisitors) ? d.uniqueVisitors : 0,
    }));

    return NextResponse.json({
      days,
      note: '순방문은 쿠키 기준 당일 첫 방문 1회로 추정됩니다. 공개 페이지만 집계(/admin 제외).',
    });
  } catch (err) {
    console.error('site-visits-history:', err);
    return NextResponse.json({ error: '조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
