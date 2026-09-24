import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { practiceMember } from '@/lib/practice-auth';
import { practiceStats } from '@/lib/practice-questions';

export const dynamic = 'force-dynamic';

/** 학습실 — 내 기록 분석(유형·번호·회차별 정답률, 복습할 오답) */
export async function GET(request: NextRequest) {
  const me = await practiceMember(request);
  if (!me) return NextResponse.json({ error: '회원만 이용할 수 있습니다.', member: false }, { status: 401 });
  try {
    const db = await getDb('gomijoshua');
    return NextResponse.json({ ok: true, ...(await practiceStats(db, me.loginId)) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[practice/stats]', e);
    return NextResponse.json({ error: '기록을 불러오지 못했습니다.' }, { status: 500 });
  }
}
