import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getGrammarShortage, GRAMMAR_MODES, type GrammarMode } from '@/lib/grammar-workbooks-store';

export const dynamic = 'force-dynamic';

/**
 * GET ?textbook=NAME&modes=FGHJ&folder=NAME
 * 한 교재에서 modes 가 모두 완료된 doc 이 없는 지문 목록.
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const textbook = request.nextUrl.searchParams.get('textbook')?.trim();
  if (!textbook) return NextResponse.json({ error: 'textbook 이 필요합니다.' }, { status: 400 });

  const modesRaw = (request.nextUrl.searchParams.get('modes') ?? 'FGHJ').toUpperCase();
  const requiredModes: GrammarMode[] = [];
  for (const ch of modesRaw) {
    if ((GRAMMAR_MODES as string[]).includes(ch) && !requiredModes.includes(ch as GrammarMode)) {
      requiredModes.push(ch as GrammarMode);
    }
  }
  if (requiredModes.length === 0) requiredModes.push('F', 'G', 'H', 'J');

  const folder = request.nextUrl.searchParams.get('folder') ?? 'all';
  const chapter = request.nextUrl.searchParams.get('chapter')?.trim() || undefined;

  try {
    const result = await getGrammarShortage({ textbook, requiredModes, folder, chapter });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error('[grammar-workbook/shortage]', e);
    return NextResponse.json({ error: 'shortage 조회 실패' }, { status: 500 });
  }
}
