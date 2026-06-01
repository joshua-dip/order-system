import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getGrammarWorkbook, GRAMMAR_MODES, type GrammarMode } from '@/lib/grammar-workbooks-store';
import { buildSingleWorkbookHtml } from '@/lib/grammar-workbook-print';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { id } = await ctx.params;
  const doc = await getGrammarWorkbook(id);
  if (!doc) {
    return NextResponse.json({ error: '워크북을 찾을 수 없습니다.' }, { status: 404 });
  }

  const modesParam = request.nextUrl.searchParams.get('modes')?.trim() || '';
  const includePoints = (request.nextUrl.searchParams.get('points') ?? '1') !== '0';
  const layout = request.nextUrl.searchParams.get('layout') === 'back' ? 'back' : 'interleaved';
  const modes = modesParam
    ? (modesParam.split(',').map((s) => s.trim()) as (GrammarMode | 'P')[]).filter(
        (m) => m === 'P' || (GRAMMAR_MODES as string[]).includes(m),
      )
    : undefined;

  const built = buildSingleWorkbookHtml(doc, { modes, includePoints, layout });
  if (!built) {
    return NextResponse.json(
      { error: '출력할 모드가 없습니다. (modes 비어있음)' },
      { status: 404 },
    );
  }
  return NextResponse.json({
    ok: true,
    id,
    title: doc.title,
    modes: built.modes,
    layout: built.layout,
    html: built.html,
  });
}
