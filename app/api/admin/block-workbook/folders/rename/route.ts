import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { renameBlockWorkbookFolder } from '@/lib/block-workbooks-store';

export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;
  let body: { from?: unknown; to?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '잘못된 요청 본문입니다.' }, { status: 400 });
  }
  const from = typeof body.from === 'string' ? body.from.trim() : '';
  const to = typeof body.to === 'string' ? body.to.trim() : '';
  if (!from || !to) {
    return NextResponse.json({ error: 'from / to 폴더명이 필요합니다.' }, { status: 400 });
  }
  if (from === to) {
    return NextResponse.json({ ok: true, modified: 0 });
  }
  const modified = await renameBlockWorkbookFolder(from, to);
  return NextResponse.json({ ok: true, modified });
}
