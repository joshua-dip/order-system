import { NextRequest, NextResponse } from 'next/server';
import { getSolvookCatalog } from '@/lib/solvook-catalog';
import { requireAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

/** 쏠북 판매 자료 목록(공개). ?refresh=1 은 관리자만 — 6시간을 기다리지 않고 바로 새로 받는다. */
export async function GET(request: NextRequest) {
  let force = false;
  if (request.nextUrl.searchParams.get('refresh') === '1') {
    const { error } = await requireAdmin(request);
    if (error) return error;
    force = true;
  }
  try {
    const catalog = await getSolvookCatalog({ force });
    if (!catalog) return NextResponse.json({ ok: false, error: '쏠북 자료 목록을 불러오지 못했습니다.' }, { status: 503 });
    return NextResponse.json(
      { ok: true, catalog },
      { headers: { 'Cache-Control': force ? 'no-store' : 'public, max-age=300, s-maxage=600, stale-while-revalidate=3600' } },
    );
  } catch (e) {
    console.error('solbook catalog GET:', e);
    return NextResponse.json({ ok: false, error: '쏠북 자료 목록을 불러오지 못했습니다.' }, { status: 500 });
  }
}
