import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { listWorkbooksByPassage } from '@/lib/generated-workbooks-store';

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const sp = request.nextUrl.searchParams;
    const textbook = sp.get('textbook') ?? undefined;
    const page = Number(sp.get('page')) || 1;
    const limit = Number(sp.get('limit')) || 30;

    const result = await listWorkbooksByPassage({ textbook, page, limit });
    return NextResponse.json(result);
  } catch (e) {
    console.error('workbook/list GET:', e);
    return NextResponse.json({ error: '목록 조회 실패' }, { status: 500 });
  }
}
