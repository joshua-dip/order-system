import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { readMergedConvertedData } from '@/lib/converted-data-store';
import { enrichTextbooksForVocabularyList } from '@/lib/vocabulary-textbooks-enrich';
import { buildSchoolTextbooksData } from '@/lib/school-textbooks';
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
 * 교과서(학교 교과서)를 교재 트리에 얹는다 — **`canOrderSchoolTextbook` 회원에게만**.
 *
 * 교과서는 `converted_textbook_json` 에 없고 `passages` 로만 존재해서, 지금까지 이 트리를
 * 쓰는 화면(분석지·워크북)에서는 아무리 회원에게 열어 줘도 보이지 않았다.
 * `filterTextbooksByAllowed` 가 순수 교집합이라 트리에 없는 키는 그대로 사라지기 때문이다.
 *
 * 그렇다고 트리에 영구 저장하면 허용목록이 「미설정=전체허용」인 회원(워크북 36명 등)에게
 * 교과서 58권이 한꺼번에 노출된다. 그래서 저장하지 않고 **요청 단위로, 권한이 있을 때만**
 * 합친다. 권한이 없거나 비로그인이면 이 함수는 원본을 그대로 돌려준다.
 *
 * 변형문제 주문서는 예전부터 `/api/textbooks/school` 을 따로 불러 왔고, 그쪽과 키가 같아
 * 여기서 합쳐져도 결과는 같다(같은 키를 같은 트리로 덮어쓴다).
 */
async function mergeSchoolTextbooksIfPermitted(
  request: NextRequest,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  try {
    const token = request.cookies.get(COOKIE_NAME)?.value;
    if (!token) return data;
    const payload = await verifyToken(token).catch(() => null);
    if (!payload?.sub) return data;

    const db = await getDb('gomijoshua');
    const user = await db
      .collection('users')
      .findOne({ _id: new ObjectId(payload.sub) }, { projection: { canOrderSchoolTextbook: 1 } });
    if (!user?.canOrderSchoolTextbook) return data;

    const school = await buildSchoolTextbooksData(db);
    if (school.keys.length === 0) return data;
    /* 트리에 이미 있는 교재는 건드리지 않는다 — 관리자가 반영한 내용이 우선이다. */
    const out = { ...data };
    for (const k of school.keys) {
      if (k in out) continue;
      out[k] = school.data[k];
    }
    return out;
  } catch (e) {
    /* 교과서 병합 실패가 교재 목록 전체를 막으면 안 된다. */
    console.error('교과서 트리 병합 실패:', e);
    return data;
  }
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
    data = await mergeSchoolTextbooksIfPermitted(request, data);

    /* 교재 **목록** 화면은 이름만 있으면 된다. 강·번호 트리까지 통째로 내리면
       124KB 인데 이름만 추리면 1KB 다(88배). 목록이 뜨기까지 이걸 기다리느라
       느려서, 이름만 받는 모드를 둔다. 강·번호는 교재를 고른 뒤에 받으면 된다.
       값은 자리만 채운다 — 호출부는 Object.keys 로만 쓴다. */
    if (request.nextUrl.searchParams.get('namesOnly') === '1') {
      const names = Object.fromEntries(Object.keys(data).map((k) => [k, 1]));
      return NextResponse.json(names, { headers: { 'Cache-Control': 'no-store' } });
    }
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
