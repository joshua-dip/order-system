import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getBlockWorkbook, deleteBlockWorkbook } from '@/lib/block-workbooks-store';

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
