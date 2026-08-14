import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { listVisibleHomeNotices } from '@/lib/home-notices';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 홈 상단 공지 배너용 — 비로그인도 호출한다.
 * 로그인 여부만 판별해 audience(all/guest/member) 를 거른다.
 */
export async function GET(request: NextRequest) {
  let isMember = false;
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (token) {
    const payload = await verifyToken(token).catch(() => null);
    isMember = !!payload?.sub;
  }

  try {
    const db = await getDb('gomijoshua');
    const notices = await listVisibleHomeNotices(db, isMember);
    return NextResponse.json({ ok: true, notices });
  } catch (e) {
    console.error('[home-notices] 조회 실패', e);
    // 공지는 부가 정보다 — 실패해도 홈이 깨지지 않도록 빈 목록으로 응답한다
    return NextResponse.json({ ok: true, notices: [] });
  }
}
