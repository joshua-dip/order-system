import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import {
  deleteGrammarFolder,
  renameGrammarFolder,
} from '@/lib/grammar-workbooks-store';

export const dynamic = 'force-dynamic';

/** PATCH: 폴더 이름 변경 — body { from, to } */
export async function PATCH(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;
  try {
    const body = (await request.json()) as { from?: unknown; to?: unknown };
    const from = typeof body.from === 'string' ? body.from.trim() : '';
    const to = typeof body.to === 'string' ? body.to.trim() : '';
    if (!from || !to) {
      return NextResponse.json({ error: 'from / to 가 필요합니다.' }, { status: 400 });
    }
    if (from === to) {
      return NextResponse.json({ ok: true, modified: 0, note: '같은 이름' });
    }
    const modified = await renameGrammarFolder(from, to);
    return NextResponse.json({ ok: true, modified });
  } catch (e) {
    console.error('grammar-workbook/folder PATCH:', e);
    return NextResponse.json({ error: '폴더 이름 변경 실패' }, { status: 500 });
  }
}

/** DELETE: 폴더 일괄 삭제 — query ?name=… (해당 폴더의 모든 doc 제거) */
export async function DELETE(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;
  const name = request.nextUrl.searchParams.get('name')?.trim() ?? '';
  if (!name) {
    return NextResponse.json({ error: 'name 쿼리가 필요합니다.' }, { status: 400 });
  }
  try {
    const deleted = await deleteGrammarFolder(name);
    return NextResponse.json({ ok: true, deleted });
  } catch (e) {
    console.error('grammar-workbook/folder DELETE:', e);
    return NextResponse.json({ error: '폴더 삭제 실패' }, { status: 500 });
  }
}
