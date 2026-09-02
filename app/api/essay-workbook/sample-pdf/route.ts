import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { renderEssayGroupsToPdfs } from '@/lib/essay-pdf-render';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // puppeteer 렌더 여유

/**
 * 서술형 워크북 샘플 PDF — 로그인 없이 받을 수 있는 미리보기.
 * payperic.com 처럼 "난이도별(기본·중·고·최고) 묶음" 을 그대로 보여주기 위해,
 * 모의고사 교재의 한 지문에서 4난도를 모아 한 PDF 로 렌더한다. (모의고사 자료가 없으면 아무 교재로 fallback)
 *
 *   GET /api/essay-workbook/sample-pdf?type=arrange|meaning
 */
const DIFF_ORDER = ['기본난도', '중난도', '고난도', '최고난도'] as const;

interface GroupRow {
  _id: { textbook: string; sourceKey: string };
  exams: { id: unknown; difficulty: string }[];
  diffs: string[];
  last: Date;
}

async function findSampleGroup(
  col: ReturnType<Awaited<ReturnType<typeof getDb>>['collection']>,
  typeFilter: Record<string, unknown>,
): Promise<GroupRow | null> {
  const pipeline = (match: Record<string, unknown>) => [
    { $match: { isPlaceholder: { $ne: true }, ...match, ...typeFilter } },
    {
      $group: {
        _id: { textbook: '$textbook', sourceKey: '$sourceKey' },
        exams: { $push: { id: '$_id', difficulty: '$difficulty' } },
        diffs: { $addToSet: '$difficulty' },
        last: { $max: '$createdAt' },
      },
    },
    { $sort: { last: -1 } },
    { $limit: 60 },
  ];
  // 1) 모의고사 교재 우선
  let rows = (await col.aggregate(pipeline({ textbook: { $regex: '영어모의고사' } })).toArray()) as GroupRow[];
  // 2) 없으면 아무 교재
  if (rows.length === 0) rows = (await col.aggregate(pipeline({})).toArray()) as GroupRow[];
  if (rows.length === 0) return null;
  // 난도 많은(가능하면 4난도) 그룹 우선, 동률이면 최신
  rows.sort((a, b) => (b.diffs?.length ?? 0) - (a.diffs?.length ?? 0));
  return rows[0];
}

export async function GET(request: NextRequest) {
  try {
    const type = request.nextUrl.searchParams.get('type') === 'meaning' ? 'meaning' : 'arrange';
    const typeFilter =
      type === 'meaning'
        ? { 'data.meta.examType': '글의의미서술형' }
        : { 'data.meta.examType': { $exists: false } };

    const db = await getDb('gomijoshua');
    const col = db.collection('essay_exams');

    const group = await findSampleGroup(col, typeFilter);
    if (!group) return NextResponse.json({ error: '샘플 자료가 없습니다.' }, { status: 404 });

    // 난도 순서대로 지문당 한 문항씩
    const byDiff = new Map<string, string>();
    for (const e of group.exams) {
      if (typeof e.difficulty === 'string' && !byDiff.has(e.difficulty)) byDiff.set(e.difficulty, String(e.id));
    }
    const ids = DIFF_ORDER.map((d) => byDiff.get(d)).filter((v): v is string => !!v);
    const finalIds = ids.length > 0 ? ids : group.exams.slice(0, 4).map((e) => String(e.id));
    if (finalIds.length === 0) return NextResponse.json({ error: '샘플 자료가 없습니다.' }, { status: 404 });

    const label = type === 'meaning' ? '글의의미 서술형' : '조건영작배열';
    const name = `${group._id.textbook} ${group._id.sourceKey}`;
    const rendered = await renderEssayGroupsToPdfs([{ name, ids: finalIds }]);
    const pdf = rendered[0]?.pdfs?.[0];
    if (!pdf) return NextResponse.json({ error: '샘플 생성에 실패했습니다.' }, { status: 500 });

    const filename = `서술형워크북_샘플_${label}_${finalIds.length}난도.pdf`;
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Cache-Control': 'public, max-age=1800',
      },
    });
  } catch (e) {
    console.error('[essay-workbook sample-pdf]', e);
    return NextResponse.json({ error: '샘플 생성에 실패했습니다.' }, { status: 500 });
  }
}
