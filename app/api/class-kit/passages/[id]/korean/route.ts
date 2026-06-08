import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { passageAnalysisFileNameForPassageId } from '@/lib/passage-analyzer-types';
import {
  classKitTextbookDeniedMessage,
  isClassKitTextbookAllowed,
  resolveClassKitAccess,
} from '@/lib/class-kit-access';

export const dynamic = 'force-dynamic';

/**
 * 사용자용 GET /api/class-kit/passages/:id/korean — 한국어 해석.
 * 비-관리자(회원·게스트)는 passage.textbook 이 모의고사 키여야만 응답.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let oid: ObjectId;
  try {
    oid = new ObjectId(id);
  } catch {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  const { level } = await resolveClassKitAccess(_req);

  try {
    const db = await getDb('gomijoshua');
    const p = await db
      .collection('passages')
      .findOne(
        { _id: oid },
        { projection: { textbook: 1, 'content.sentences_en': 1, 'content.sentences_ko': 1 } },
      );

    if (!p) return NextResponse.json({ error: 'not found' }, { status: 404 });
    const tb = String((p as { textbook?: unknown }).textbook ?? '');
    if (!isClassKitTextbookAllowed(tb, level)) {
      return NextResponse.json({ error: classKitTextbookDeniedMessage(level) }, { status: 403 });
    }

    const c = (p?.content ?? {}) as Record<string, unknown>;
    const passageEn = Array.isArray(c.sentences_en)
      ? (c.sentences_en as unknown[]).map((s) => String(s ?? '').trim()).filter(Boolean)
      : [];
    const passageKo = Array.isArray(c.sentences_ko)
      ? (c.sentences_ko as unknown[]).map((s) => String(s ?? '').trim())
      : [];

    if (passageKo.some(Boolean)) {
      return NextResponse.json({
        sentences_en: passageEn,
        sentences_ko: passageKo,
        source: 'passages' as const,
      });
    }

    const fileName = passageAnalysisFileNameForPassageId(id);
    const ana = await db
      .collection('passage_analyses')
      .findOne(
        { fileName },
        { projection: { 'passageStates.main.sentences': 1, 'passageStates.main.koreanSentences': 1 } },
      );

    const main = (ana as { passageStates?: { main?: Record<string, unknown> } } | null)?.passageStates?.main ?? null;
    const anaEn =
      main && Array.isArray(main.sentences)
        ? (main.sentences as unknown[]).map((s) => String(s ?? '').trim()).filter(Boolean)
        : [];
    const anaKo =
      main && Array.isArray(main.koreanSentences)
        ? (main.koreanSentences as unknown[]).map((s) => String(s ?? '').trim())
        : [];

    if (anaKo.some(Boolean)) {
      return NextResponse.json({ sentences_en: anaEn, sentences_ko: anaKo, source: 'analyzer' as const });
    }

    return NextResponse.json({
      sentences_en: passageEn.length ? passageEn : anaEn,
      sentences_ko: [],
      source: null,
    });
  } catch (e) {
    console.error('class-kit passage/korean:', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
