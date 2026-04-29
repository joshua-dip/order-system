import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import {
  getBlockWorkbook,
  deleteBlockWorkbook,
  updateBlockWorkbookMeta,
} from '@/lib/block-workbooks-store';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { id } = await ctx.params;
  const doc = await getBlockWorkbook(id);
  if (!doc) {
    return NextResponse.json({ error: '문서를 찾을 수 없습니다.' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, item: doc });
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const { error } = await requireAdmin(request);
  if (error) return error;
  const { id } = await ctx.params;
  let body: { folder?: unknown; title?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '잘못된 요청 본문입니다.' }, { status: 400 });
  }
  const patch: { folder?: string; title?: string } = {};
  if (typeof body.folder === 'string') patch.folder = body.folder;
  if (typeof body.title === 'string') patch.title = body.title;
  if (!('folder' in patch) && !('title' in patch)) {
    return NextResponse.json({ error: '변경할 필드가 없습니다.' }, { status: 400 });
  }
  const ok = await updateBlockWorkbookMeta(id, patch);
  if (!ok) {
    return NextResponse.json({ error: '문서를 찾을 수 없습니다.' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { id } = await ctx.params;
  const ok = await deleteBlockWorkbook(id);
  if (!ok) {
    return NextResponse.json({ error: '삭제 실패 또는 문서 없음' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
