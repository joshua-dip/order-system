import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';

/**
 * 순서 유형 문항 정답 분포 검증.
 *
 * GET ?textbook=... 
 * 순서(글의 순서) 유형 문항의 CorrectAnswer(①~⑤) 분포를 집계하고,
 * 특정 번호에 과도하게 편중(threshold 이상)되면 경고.
 *
 * 결과:
 *   distribution:   { "①": 3, "②": 0, "③": 0, "④": 2, "⑤": 145 }
 *   skewed:         편중 여부
 *   skewedAnswer:   편중된 번호
 *   items:          편중된 번호에 해당하는 문항 목록 (source, id 등)
 */

const CIRCLED = ['①', '②', '③', '④', '⑤'] as const;
const SKEW_THRESHOLD = 0.6; // 60% 이상이면 편중으로 판단
const MAX_ITEMS = 3000;

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const textbook = request.nextUrl.searchParams.get('textbook')?.trim() || '';

  const match: Record<string, unknown> = {
    type: '순서',
    deleted_at: null,
    'question_data.CorrectAnswer': { $exists: true },
  };
  if (textbook) match.textbook = textbook;

  try {
    const db = await getDb('gomijoshua');
    const col = db.collection('generated_questions');

    const pipeline = [
      { $match: match },
      {
        $group: {
          _id: '$question_data.CorrectAnswer',
          count: { $sum: 1 },
          items: {
            $push: {
              id: { $toString: '$_id' },
              textbook: '$textbook',
              source: '$source',
              options: '$question_data.Options',
              paragraph: {
                $substrCP: [
                  { $ifNull: ['$question_data.Paragraph', ''] },
                  0,
                  200,
                ],
              },
            },
          },
        },
      },
    ];

    const groups = await col.aggregate(pipeline).toArray();

    const distribution: Record<string, number> = {};
    for (const c of CIRCLED) distribution[c] = 0;
    let otherCount = 0;
    let totalCount = 0;

    const allItemsByAnswer = new Map<
      string,
      { id: string; textbook: string; source: string; options: string; paragraph: string }[]
    >();

    for (const g of groups) {
      const answer = typeof g._id === 'string' ? g._id.trim() : String(g._id ?? '');
      const count = Number(g.count);
      totalCount += count;

      if (CIRCLED.includes(answer as typeof CIRCLED[number])) {
        distribution[answer] = (distribution[answer] ?? 0) + count;
      } else {
        otherCount += count;
      }

      allItemsByAnswer.set(answer, (g.items as typeof allItemsByAnswer extends Map<string, infer V> ? V : never) ?? []);
    }

    let skewed = false;
    let skewedAnswer: string | null = null;
    let skewedPct = 0;

    if (totalCount > 0) {
      for (const c of CIRCLED) {
        const pct = (distribution[c] ?? 0) / totalCount;
        if (pct >= SKEW_THRESHOLD) {
          skewed = true;
          skewedAnswer = c;
          skewedPct = pct;
          break;
        }
      }
    }

    const items: { id: string; textbook: string; source: string; answer: string; options: string; paragraph: string }[] = [];
    if (skewed && skewedAnswer) {
      const raw = allItemsByAnswer.get(skewedAnswer) ?? [];
      for (const it of raw) {
        if (items.length >= MAX_ITEMS) break;
        items.push({ ...it, answer: skewedAnswer });
      }
    }

    return NextResponse.json({
      ok: true,
      filters: { textbook: textbook || null },
      totalCount,
      distribution,
      otherCount,
      skewed,
      skewedAnswer,
      skewedPct: Math.round(skewedPct * 1000) / 10,
      threshold: SKEW_THRESHOLD * 100,
      itemCount: items.length,
      truncated: items.length >= MAX_ITEMS,
      items,
    });
  } catch (e) {
    console.error('validate/order-abc-distribution GET:', e);
    return NextResponse.json({ error: '검증 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
