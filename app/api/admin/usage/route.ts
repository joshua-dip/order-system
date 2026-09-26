import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { getMemberUsage, getUsageReport } from '@/lib/site-usage-report';

export const dynamic = 'force-dynamic';

/**
 * 사용 기록 분석(관리자). ?days=30(최대 180) · ?includeAdmin=1 · ?loginId=… 이면 그 회원의 최근 기록.
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;
  const sp = request.nextUrl.searchParams;
  const days = Math.min(180, Math.max(1, parseInt(sp.get('days') || '30', 10) || 30));
  const db = await getDb('gomijoshua');
  const loginId = sp.get('loginId')?.trim();
  if (loginId) return NextResponse.json(await getMemberUsage(db, loginId, days));
  return NextResponse.json(await getUsageReport(db, { days, includeAdmin: sp.get('includeAdmin') === '1' }));
}
