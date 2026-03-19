import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';

const MAX_GROUPS = 300;
const SAMPLE_PER_GROUP = 50;

/**
 * 같은 유형(type) 안에서 question_data.Options 가 동일(trim)한 문서끼리 묶음.
 * exclude_types: 쉼표로 구분된 유형명 — 해당 유형 문서는 검증 대상에서 제외.
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const textbook = request.nextUrl.searchParams.get('textbook')?.trim() || '';
  const typeFilter = request.nextUrl.searchParams.get('type')?.trim() || '';
  const excludeRaw = request.nextUrl.searchParams.get('exclude_types')?.trim() || '';
  const excludeTypes = [
    ...request.nextUrl.searchParams.getAll('exclude_type').map((s) => s.trim()),
    ...excludeRaw.split(',').map((s) => s.trim()),
  ].filter(Boolean);
  const excludeUnique = [...new Set(excludeTypes)];

  const match: Record<string, unknown> = {
    'question_data.Options': { $exists: true, $type: 'string' },
  };
  if (textbook) match.textbook = textbook;

  if (typeFilter) {
    match.type = typeFilter;
  } else if (excludeUnique.length > 0) {
    match.type = { $nin: excludeUnique };
  }

  try {
    const db = await getDb('gomijoshua');
    const col = db.collection('generated_questions');

    const pipeline = [
      { $match: match },
      {
        $addFields: {
          optNorm: {
            $trim: { input: { $ifNull: ['$question_data.Options', ''] } },
          },
        },
      },
      { $match: { optNorm: { $ne: '' } } },
      {
        $group: {
          _id: {
            questionType: '$type',
            optKey: '$optNorm',
          },
          count: { $sum: 1 },
          items: {
            $push: {
              id: { $toString: '$_id' },
              textbook: '$textbook',
              source: '$source',
              type: '$type',
            },
          },
        },
      },
      { $match: { count: { $gt: 1 } } },
      { $sort: { count: -1 as const } },
      { $limit: MAX_GROUPS },
      {
        $project: {
          questionType: '$_id.questionType',
          optionsFull: '$_id.optKey',
          duplicateCount: '$count',
          sampleItems: { $slice: ['$items', SAMPLE_PER_GROUP] },
        },
      },
    ];

    const groups = await col.aggregate(pipeline).toArray();

    const scanned = await col.countDocuments(match);

    const mapped = groups.map((g) => ({
      questionType: String(g.questionType ?? '—'),
      optionsFull: String(g.optionsFull ?? ''),
      optionsPreview:
        String(g.optionsFull ?? '').length > 400
          ? `${String(g.optionsFull ?? '').slice(0, 400)}…`
          : String(g.optionsFull ?? ''),
      duplicateCount: g.duplicateCount as number,
      sampleItems: g.sampleItems as { id: string; textbook: string; source: string; type: string }[],
      truncated: (g.duplicateCount as number) > SAMPLE_PER_GROUP,
    }));

    const summaryByType: Record<string, number> = {};
    for (const g of mapped) {
      const t = g.questionType || '—';
      summaryByType[t] = (summaryByType[t] || 0) + 1;
    }

    return NextResponse.json({
      ok: true,
      filters: {
        textbook: textbook || null,
        type: typeFilter || null,
      },
      excludedTypes: excludeUnique,
      scannedDocuments: scanned,
      duplicateGroupCount: mapped.length,
      summaryByType,
      groups: mapped,
    });
  } catch (e) {
    console.error('duplicate-options validate:', e);
    return NextResponse.json({ error: '검증 조회에 실패했습니다.' }, { status: 500 });
  }
}
