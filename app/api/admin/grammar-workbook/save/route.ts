import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import {
  saveGrammarWorkbook,
  GRAMMAR_MODES,
  type GrammarMode,
  type GrammarModeData,
} from '@/lib/grammar-workbooks-store';
import {
  buildEitherOrHtml,
  buildCorrectionHtml,
  buildOxHtml,
  buildTransformHtml,
  type ExamMeta,
} from '@/lib/grammar-workbook-html';
import type { SentenceTokenized } from '@/lib/block-workbook-types';

/**
 * POST — 한 지문에 대해 활성 모드(F/G/H/J) 데이터를 한 번에 저장.
 *
 * Body:
 *   {
 *     passageId?, textbook, sourceKey, title, folder?,
 *     examMeta?: { examTitle, schoolName, grade, questionNumber, examSubtitle },
 *     sentences: SentenceTokenized[],
 *     modes: ('F'|'G'|'H'|'J')[],
 *     modeData: { F?: {blocks}, G?: {points}, H?: {spans}, J?: {items, intro?} }
 *   }
 * passageId 가 있고 같은 폴더의 doc 이 이미 있으면 upsert.
 */
export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const body = await request.json();
    const passageId = typeof body.passageId === 'string' ? body.passageId.trim() : '';
    const textbook = typeof body.textbook === 'string' ? body.textbook.trim() : '';
    const sourceKey = typeof body.sourceKey === 'string' ? body.sourceKey.trim() : '';
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const folder = typeof body.folder === 'string' && body.folder.trim() ? body.folder.trim() : '기본';
    const examMeta = (body.examMeta && typeof body.examMeta === 'object' ? body.examMeta : {}) as ExamMeta;
    const sentences = (Array.isArray(body.sentences) ? body.sentences : []) as SentenceTokenized[];
    const modes = (Array.isArray(body.modes) ? body.modes : [])
      .filter((m: unknown): m is GrammarMode => typeof m === 'string' && (GRAMMAR_MODES as string[]).includes(m));
    const modeData = (body.modeData && typeof body.modeData === 'object' ? body.modeData : {}) as GrammarModeData;

    if (modes.length === 0) {
      return NextResponse.json({ error: '저장할 모드를 1개 이상 활성화하세요.' }, { status: 400 });
    }
    // 지문 기반 모드(F/G/H) 가 활성이면 textbook/sourceKey 필수.
    // J 단독이면 자유 입력이므로 기본값으로 보충.
    const needsPassage = modes.some((m: GrammarMode) => m !== 'J');
    if (needsPassage && (!textbook || !sourceKey)) {
      return NextResponse.json(
        { error: 'F·G·H 모드 저장에는 textbook, sourceKey 가 필요합니다.' },
        { status: 400 },
      );
    }
    const effectiveTextbook = textbook || '(자유 입력)';
    const effectiveSourceKey = sourceKey || `자유 입력 ${new Date().toISOString().slice(0, 10)}`;
    const effectiveTitle = title || `어법공략 워크북 ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;

    // 모드별 HTML 생성
    const html: Partial<Record<GrammarMode, string>> = {};
    const buildOpts = { title: effectiveTitle, textbook: effectiveTextbook, sourceKey: effectiveSourceKey, ...examMeta };

    if (modes.includes('F') && modeData.F) {
      html.F = buildTransformHtml({
        ...buildOpts,
        sentences,
        blocks: modeData.F.blocks ?? [],
      });
    }
    if (modes.includes('G') && modeData.G) {
      html.G = buildEitherOrHtml({
        ...buildOpts,
        sentences,
        points: modeData.G.points ?? [],
      });
    }
    if (modes.includes('H') && modeData.H) {
      html.H = buildCorrectionHtml({
        ...buildOpts,
        sentences,
        spans: modeData.H.spans ?? [],
      });
    }
    if (modes.includes('J') && modeData.J) {
      html.J = buildOxHtml({
        ...buildOpts,
        intro: modeData.J.intro,
        items: modeData.J.items ?? [],
      });
    }

    const result = await saveGrammarWorkbook({
      passageId: passageId || undefined,
      textbook: effectiveTextbook,
      sourceKey: effectiveSourceKey,
      title: effectiveTitle,
      folder,
      examMeta,
      sentences,
      modes,
      modeData,
      html,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error('grammar-workbook/save POST:', e);
    return NextResponse.json({ error: '저장에 실패했습니다.' }, { status: 500 });
  }
}
