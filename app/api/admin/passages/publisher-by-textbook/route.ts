import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';

const VALID_PUBLISHERS = ['YBM', '쎄듀', 'NE능률'] as const;
type Publisher = (typeof VALID_PUBLISHERS)[number];

/**
 * 교재별 출판사 조회/일괄 변경.
 * passages 컬렉션에서 교재명 기준으로 publisher 필드를 읽거나 일괄 업데이트한다.
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const db = await getDb('gomijoshua');
    // textbook → publisher 집계 (교재당 대표값: 값이 있는 첫 번째)
    const pipeline = [
      { $group: { _id: '$textbook', publisher: { $first: '$publisher' } } },
      { $project: { textbook: '$_id', publisher: 1, _id: 0 } },
    ];
    const rows = await db.collection('passages').aggregate(pipeline).toArray();
    const publishers: Record<string, string | null> = {};
    for (const row of rows) {
      const key = String(row.textbook || '');
      if (!key) continue;
      publishers[key] = typeof row.publisher === 'string' && VALID_PUBLISHERS.includes(row.publisher as Publisher)
        ? row.publisher
        : null;
    }
    return NextResponse.json({ publishers });
  } catch (e) {
    console.error('publisher-by-textbook GET:', e);
    return NextResponse.json({ error: '조회에 실패했습니다.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const body = await request.json();
    const textbookKey = typeof body.textbookKey === 'string' ? body.textbookKey.trim() : '';
    if (!textbookKey) {
      return NextResponse.json({ error: '교재명이 필요합니다.' }, { status: 400 });
    }
    const publisherRaw = typeof body.publisher === 'string' ? body.publisher.trim() : '';
    const publisher: Publisher | null = VALID_PUBLISHERS.includes(publisherRaw as Publisher)
      ? (publisherRaw as Publisher)
      : null;

    const db = await getDb('gomijoshua');
    const col = db.collection('passages');
    const $set: Record<string, unknown> = { updated_at: new Date() };
    if (publisher) {
      $set.publisher = publisher;
    }
    const $unset: Record<string, unknown> = {};
    if (!publisher) {
      $unset.publisher = '';
    }

    const update = publisher
      ? { $set }
      : { $set: { updated_at: new Date() }, $unset: { publisher: '' } };

    const result = await col.updateMany({ textbook: textbookKey }, update);
    return NextResponse.json({
      ok: true,
      textbookKey,
      publisher,
      modifiedCount: result.modifiedCount,
    });
  } catch (e) {
    console.error('publisher-by-textbook POST:', e);
    return NextResponse.json({ error: '업데이트에 실패했습니다.' }, { status: 500 });
  }
}
