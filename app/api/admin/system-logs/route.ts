import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';

/**
 * GET /api/admin/system-logs
 * 관리자용 시스템 로그 조회. 쿼리: type, limit, sortBy, sortOrder
 * 현재는 빈 목록 반환 (추후 로그 수집 시 확장 가능)
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

    const { searchParams } = new URL(request.url);
    const _type = searchParams.get('type');
    const _limit = searchParams.get('limit');
    const _sortBy = searchParams.get('sortBy');
    const _sortOrder = searchParams.get('sortOrder');

    return NextResponse.json({
      logs: [],
      total: 0,
    });
  } catch (err) {
    console.error('system-logs 조회 실패:', err);
    return NextResponse.json({ error: '조회에 실패했습니다.' }, { status: 500 });
  }
}
