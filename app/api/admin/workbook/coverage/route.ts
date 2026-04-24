import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { listWorkbookCoverage } from '@/lib/generated-workbooks-store';

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const rows = await listWorkbookCoverage();
    return NextResponse.json({ ok: true, rows });
  } catch (e) {
    console.error('workbook/coverage GET:', e);
    return NextResponse.json({ error: '커버리지 조회 실패' }, { status: 500 });
  }
}
