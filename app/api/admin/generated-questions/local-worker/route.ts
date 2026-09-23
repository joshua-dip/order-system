import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { getLocalWorkerStatus } from '@/lib/local-variant-jobs';

/** GPU PC 워커 하트비트 — 온라인 여부와 유형별 어댑터 학습 여부 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const db = await getDb('gomijoshua');
    return NextResponse.json({ ok: true, ...(await getLocalWorkerStatus(db)) });
  } catch (e) {
    console.error('local-worker GET:', e);
    return NextResponse.json({ error: '워커 상태 조회에 실패했습니다.' }, { status: 500 });
  }
}
