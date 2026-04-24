import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { parsePassageIdFromFileName } from '@/lib/passage-analyzer-types';

/**
 * GET /api/admin/passages/textbooks
 *   passages.textbook 전체 distinct (기본)
 *
 * GET /api/admin/passages/textbooks?vocabularyAnalyzedOnly=1
 *   passage_analyses 에서 main.vocabularyList 가 1개 이상인 지문만 두고,
 *   해당 지문들의 textbook 만 반환 (지문분석기·단어장 연동 교재만 노출용)
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const db = await getDb('gomijoshua');
    const vocabularyOnly =
      request.nextUrl.searchParams.get('vocabularyAnalyzedOnly') === '1' ||
      request.nextUrl.searchParams.get('vocabularyAnalyzedOnly') === 'true';

    if (!vocabularyOnly) {
      const textbooks = await db.collection('passages').distinct('textbook');
      const sorted = (textbooks as string[]).filter(Boolean).sort((a, b) => a.localeCompare(b, 'ko'));
      return NextResponse.json({ textbooks: sorted });
    }

    const analyses = await db
      .collection('passage_analyses')
      .find({ 'passageStates.main.vocabularyList.0': { $exists: true } })
      .project({ fileName: 1 })
      .toArray();

    const passageHexIds = new Set<string>();
    for (const a of analyses) {
      const fn = String((a as { fileName?: string }).fileName || '');
      const pid = parsePassageIdFromFileName(fn);
      if (pid) passageHexIds.add(pid);
    }

    if (passageHexIds.size === 0) {
      return NextResponse.json({ textbooks: [] as string[] });
    }

    const oids: ObjectId[] = [];
    for (const id of passageHexIds) {
      try {
        oids.push(new ObjectId(id));
      } catch {
        /* skip invalid */
      }
    }
    if (oids.length === 0) {
      return NextResponse.json({ textbooks: [] as string[] });
    }

    const textbooks = await db.collection('passages').distinct('textbook', { _id: { $in: oids } });
    const sorted = (textbooks as string[]).filter(Boolean).sort((a, b) => a.localeCompare(b, 'ko'));
    return NextResponse.json({ textbooks: sorted });
  } catch (e) {
    console.error('passages textbooks:', e);
    return NextResponse.json({ error: '조회에 실패했습니다.' }, { status: 500 });
  }
}
