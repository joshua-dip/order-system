import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { detectAllCorrectClaim } from '@/lib/grammar-explanation-all-correct';

const MAX_SCAN = 10000;

/**
 * type=어법 중 해설(Explanation)이 "모든 어법이 맞다 / 정답이 없다 / 오류 없다" 등
 * 정답 없는 문항임을 단언한 사례를 검출. 교재 필터 적용.
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const textbook = request.nextUrl.searchParams.get('textbook')?.trim() || '';

  try {
    const db = await getDb('gomijoshua');
    const col = db.collection('generated_questions');

    const match: Record<string, unknown> = { type: '어법' };
    if (textbook) match.textbook = textbook;

    const totalScanned = await col.countDocuments(match);

    const docs = await col
      .find(match)
      .project({
        _id: 1,
        textbook: 1,
        source: 1,
        passage_id: 1,
        status: 1,
        'question_data.CorrectAnswer': 1,
        'question_data.Explanation': 1,
      })
      .sort({ textbook: 1, source: 1, _id: 1 })
      .limit(MAX_SCAN)
      .toArray();

    type Item = {
      id: string;
      textbook: string;
      source: string;
      passageId: string;
      status: string;
      correctAnswer: string;
      labels: string[];
      strong: boolean;
      snippet: string;
    };

    const items: Item[] = [];
    const labelCounter = new Map<string, number>();

    for (const d of docs) {
      const qd = (d.question_data as Record<string, unknown>) || {};
      const explanation =
        typeof qd.Explanation === 'string' ? (qd.Explanation as string) : '';
      const hits = detectAllCorrectClaim(explanation);
      if (hits.length === 0) continue;
      const isStrong = hits.some((h) => h.strong);
      for (const h of hits) {
        labelCounter.set(h.label, (labelCounter.get(h.label) ?? 0) + 1);
      }
      items.push({
        id: String(d._id),
        textbook: String(d.textbook ?? ''),
        source: String(d.source ?? ''),
        passageId: String(d.passage_id ?? ''),
        status: String(d.status ?? ''),
        correctAnswer:
          typeof qd.CorrectAnswer === 'string' ? (qd.CorrectAnswer as string) : '',
        labels: hits.map((h) => h.label),
        strong: isStrong,
        snippet:
          explanation.length > 200 ? explanation.slice(0, 200) + '…' : explanation,
      });
    }

    const byLabel: { label: string; count: number }[] = [...labelCounter.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => ({ label, count }));

    return NextResponse.json({
      ok: true,
      filters: { textbook: textbook || null, type: '어법' },
      totalScanned,
      scanned: docs.length,
      truncated: totalScanned > MAX_SCAN,
      maxScan: MAX_SCAN,
      withHits: items.length,
      strongHits: items.filter((it) => it.strong).length,
      byLabel,
      items,
    });
  } catch (e) {
    console.error('validate/grammar-explanation-all-correct:', e);
    return NextResponse.json(
      { error: '어법 해설 모순 검증 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
