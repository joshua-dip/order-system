import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { readMergedConvertedData } from '@/lib/converted-data-store';
import { enrichTextbooksForVocabularyList } from '@/lib/vocabulary-textbooks-enrich';
import {
  buildMergedTextbookBranchFromPassages,
  convertedMergedHasTextbookLessonIndex,
  countMergedTextbookSlots,
  mergeMissingPassagesIntoMergedEntry,
} from '@/lib/build-converted-branch-from-passages';

/**
 * converted 병합 데이터를 passages 와 맞춘다.
 *
 * ① 강·번호 트리가 비어 있는 교재(기출 교재 등) → passages 로 새로 만든다.
 * ② 트리는 있는데 passages 에만 있는 번호가 생긴 교재(지문 추가) → 그 번호만 덧붙인다.
 *
 * ②가 필요한 이유: 예전에는 ①만 했기 때문에, 이미 트리가 있는 교재에 지문을
 * 새로 올리면 주문서에 영영 안 나왔고 관리자가 동기화 스크립트를 따로 돌려야 했다.
 *
 * 비용을 위해 먼저 교재별 (강, 번호) 개수만 집계해서 트리 슬롯 수와 비교하고,
 * 뒤처진 교재의 지문만 실제로 읽는다. 아무것도 안 바뀐 평소에는 집계 1회로 끝난다.
 * 덧붙이기는 합집합이라 트리에만 있던 번호는 지우지 않는다.
 */
async function reconcileTextbookTreesWithPassages(
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const db = await getDb('gomijoshua');

  const emptyKeys = Object.keys(data).filter((k) => !convertedMergedHasTextbookLessonIndex(data, k));

  // 교재별 distinct (강, 번호) 개수
  const counts = (await db
    .collection('passages')
    .aggregate([
      { $match: { number: { $nin: [null, ''] } } },
      { $group: { _id: { tb: '$textbook', ch: '$chapter', num: '$number' } } },
      { $group: { _id: '$_id.tb', n: { $sum: 1 } } },
    ])
    .toArray()) as { _id?: unknown; n?: number }[];

  const staleKeys: string[] = [];
  for (const row of counts) {
    const tb = String(row._id ?? '').trim();
    if (!tb || !(tb in data) || emptyKeys.includes(tb)) continue;
    if ((row.n ?? 0) > countMergedTextbookSlots(data, tb)) staleKeys.push(tb);
  }

  const targets = [...emptyKeys, ...staleKeys];
  if (targets.length === 0) return data;

  const rows = (await db
    .collection('passages')
    .find({ textbook: { $in: targets } })
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
  for (const k of staleKeys) {
    const rs = byTb.get(k);
    if (!rs || rs.length === 0) continue;
    const merged = mergeMissingPassagesIntoMergedEntry(out[k], k, rs);
    if (merged && merged.added > 0) out[k] = merged.entry;
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
    data = await reconcileTextbookTreesWithPassages(data);
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
