import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { listEssayStepWorkbooks } from '@/lib/essay-step-workbooks-store';

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;
  try {
    const items = await listEssayStepWorkbooks();
    return NextResponse.json({ ok: true, items });
  } catch (e) {
    console.error('essay-step/list:', e);
    return NextResponse.json({ error: '목록 조회 실패' }, { status: 500 });
  }
}
