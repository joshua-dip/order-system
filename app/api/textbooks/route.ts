import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { readMergedConvertedData } from '@/lib/converted-data-store';
import { enrichTextbooksForVocabularyList } from '@/lib/vocabulary-textbooks-enrich';
import {
  buildMergedTextbookBranchFromPassages,
  convertedMergedHasTextbookLessonIndex,
} from '@/lib/build-converted-branch-from-passages';

/**
 * converted 데이터에 키만 있고 강·번호 트리가 비어 있는 교재(예: 기출 교재)를
 * passages(chapter/number/order)로 채운다. 트리가 채워진 교재는 그대로 둔다.
 */
async function fillEmptyTextbookTreesFromPassages(
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const emptyKeys = Object.keys(data).filter((k) => !convertedMergedHasTextbookLessonIndex(data, k));
  if (emptyKeys.length === 0) return data;
  const db = await getDb('gomijoshua');
  const rows = (await db
    .collection('passages')
    .find({ textbook: { $in: emptyKeys } })
    .project({ textbook: 1, chapter: 1, number: 1, order: 1 })
    .toArray()) as { textbook?: string; chapter?: unknown; number?: unknown; order?: unknown }[];
  if (rows.length === 0) return data;
  const byTb = new Map<string, { chapter?: unknown; number?: unknown; order?: unknown }[]>();
  for (const r of rows) {
    const tb = String(r.textbook ?? '').trim();
    if (!tb) continue;
    if (!byTb.has(tb)) byTb.set(tb, []);
    byTb.get(tb)!.push(r);
  }
  const out = { ...data };
  for (const k of emptyKeys) {
    const rs = byTb.get(k);
    if (!rs || rs.length === 0) continue;
    const built = buildMergedTextbookBranchFromPassages(k, rs);
    if (built) out[k] = built.branch;
  }
  return out;
}

/**
 * 교재 병합 데이터를 API로 제공합니다.
 * — 관리자가 반영한 내용은 MongoDB `converted_textbook_json` 우선,
 * — 없으면 저장소의 converted_data.json (기본 번들).
 *
 * GET ?vocabularyEnrich=1
 * — 단어장용: mock-exams.json + passages 모의고사 교재명을 합쳐,
 *   병합 JSON에 강·번호 트리가 없는 모의고사만 passages 기준으로 메모리에서 채움(저장 안 함).
 */
export async function GET(request: NextRequest) {
  try {
    let data = await readMergedConvertedData();
    data = await fillEmptyTextbookTreesFromPassages(data);
    if (request.nextUrl.searchParams.get('vocabularyEnrich') === '1') {
      data = await enrichTextbooksForVocabularyList(data);
    }
    // 교재 트리는 passages/관리자 반영으로 바뀌므로 stale 캐시 방지
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('교재 데이터 로드 실패:', err);
    return NextResponse.json(
      { error: '교재 데이터를 불러올 수 없습니다.' },
      { status: 503 }
    );
  }
}
