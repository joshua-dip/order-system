import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { isDropboxConfigured } from '@/lib/dropbox';

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

    const [userOrderCounts, newMembersThisMonth, newOrdersThisWeek] = await Promise.all([
      db.collection('orders').aggregate<{ _id: string; count: number }>([
        { $match: { loginId: { $exists: true, $ne: null } } },
        { $group: { _id: '$loginId', count: { $sum: 1 } } },
      ]).toArray(),
      db.collection('users').countDocuments({ role: 'user', createdAt: { $gte: startOfMonth } }),
      db.collection('orders').countDocuments({ createdAt: { $gte: startOfWeek } }),
    ]);

    const orderCountByLoginId: Record<string, number> = {};
    userOrderCounts.forEach((row) => {
      orderCountByLoginId[row._id] = row.count;
    });

    return NextResponse.json({
      orderCountByLoginId,
      newMembersThisMonth,
      newOrdersThisWeek,
      dropboxConfigured: isDropboxConfigured(),
    });
  } catch (err) {
    console.error('관리자 통계 조회 실패:', err);
    return NextResponse.json(
      { error: '통계 조회 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
