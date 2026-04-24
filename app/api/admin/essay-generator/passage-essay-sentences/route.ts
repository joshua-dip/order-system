import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/lib/mongodb';
import { passageAnalysisFileNameForPassageId } from '@/lib/passage-analyzer-types';

export const dynamic = 'force-dynamic';

/**
 * GET ?passageId=xxx
 * 구문 분석기에서 서술형 대비로 체크한 문장 인덱스 배열 반환
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const passageId = request.nextUrl.searchParams.get('passageId')?.trim();
  if (!passageId) {
    return NextResponse.json({ indices: [] });
  }

  try {
    const db = await getDb('gomijoshua');
    const fileName = passageAnalysisFileNameForPassageId(passageId);
    const doc = await db.collection('passage_analyses').findOne({ fileName });

    if (!doc) return NextResponse.json({ indices: [] });

    const states = (doc as Record<string, unknown>).passageStates as Record<string, unknown> | undefined;
    const main = states?.main as Record<string, unknown> | undefined;
    const indices = (main?.essayHighlightedSentences as number[] | undefined) ?? [];

    return NextResponse.json({ indices });
  } catch (e) {
    console.error('[passage-essay-sentences]', e);
    return NextResponse.json({ indices: [] });
  }
}
