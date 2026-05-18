import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { passageAnalysisFileNameForPassageId } from '@/lib/passage-analyzer-types';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/passages/:id/korean
 *
 * 지문의 문장별 한국어 해석을 끌어오는 헬퍼.
 * 우선순위:
 *   1) passages.content.sentences_ko (관리자가 직접 저장한 경우)
 *   2) passage_analyses.passageStates.main.koreanSentences (분석기에 입력된 경우)
 *
 * Response: { sentences_en: string[], sentences_ko: string[], source: 'passages'|'analyzer'|null }
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { error } = await requireAdmin(_req);
  if (error) return error;

  const { id } = await ctx.params;
  let oid: ObjectId;
  try {
    oid = new ObjectId(id);
  } catch {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  try {
    const db = await getDb('gomijoshua');
    const p = await db
      .collection('passages')
      .findOne(
        { _id: oid },
        { projection: { 'content.sentences_en': 1, 'content.sentences_ko': 1 } },
      );

    const c = (p?.content ?? {}) as Record<string, unknown>;
    const passageEn = Array.isArray(c.sentences_en)
      ? (c.sentences_en as unknown[]).map(s => String(s ?? '').trim()).filter(Boolean)
      : [];
    const passageKo = Array.isArray(c.sentences_ko)
      ? (c.sentences_ko as unknown[]).map(s => String(s ?? '').trim())
      : [];

    if (passageKo.some(Boolean)) {
      return NextResponse.json({
        sentences_en: passageEn,
        sentences_ko: passageKo,
        source: 'passages' as const,
      });
    }

    // fallback: passage_analyses.passageStates.main
    const fileName = passageAnalysisFileNameForPassageId(id);
    const ana = await db
      .collection('passage_analyses')
      .findOne({ fileName }, { projection: { 'passageStates.main.sentences': 1, 'passageStates.main.koreanSentences': 1 } });

    const main = (ana as { passageStates?: { main?: Record<string, unknown> } } | null)?.passageStates?.main ?? null;
    const anaEn = main && Array.isArray(main.sentences)
      ? (main.sentences as unknown[]).map(s => String(s ?? '').trim()).filter(Boolean)
      : [];
    const anaKo = main && Array.isArray(main.koreanSentences)
      ? (main.koreanSentences as unknown[]).map(s => String(s ?? '').trim())
      : [];

    if (anaKo.some(Boolean)) {
      return NextResponse.json({
        sentences_en: anaEn,
        sentences_ko: anaKo,
        source: 'analyzer' as const,
      });
    }

    return NextResponse.json({
      sentences_en: passageEn.length ? passageEn : anaEn,
      sentences_ko: [],
      source: null,
    });
  } catch (e) {
    console.error('[passages/:id/korean] error:', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
