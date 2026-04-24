import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import {
  findWorkbookById,
  softDeleteWorkbook,
  toggleWorkbookStatus,
} from '@/lib/generated-workbooks-store';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { id } = await ctx.params;
  const doc = await findWorkbookById(id);
  if (!doc) {
    return NextResponse.json({ error: '문서를 찾을 수 없습니다.' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, item: doc });
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { id } = await ctx.params;
  const result = await softDeleteWorkbook(id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { id } = await ctx.params;
  const body = await request.json();

  if (body.action === 'toggle-status') {
    const result = await toggleWorkbookStatus(id);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 404 });
    }
    return NextResponse.json({ ok: true, newStatus: result.newStatus });
  }

  return NextResponse.json({ error: '알 수 없는 action' }, { status: 400 });
}
