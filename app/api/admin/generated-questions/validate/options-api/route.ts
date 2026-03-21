import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';

const MAX_RESULTS = 500;

/**
 * Options 필드에 'API' 텍스트가 포함된 문항 검증.
 * 교재·유형 필터 적용.
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const textbook = request.nextUrl.searchParams.get('textbook')?.trim() || '';
  const type = request.nextUrl.searchParams.get('type')?.trim() || '';

  const match: Record<string, unknown> = {
    'question_data.Options': { $regex: '\\bAPI\\b', $options: 'i' },
  };
  if (textbook) match.textbook = textbook;
  if (type) match.type = type;

  try {
    const db = await getDb('gomijoshua');
    const col = db.collection('generated_questions');

    const totalMatched = await col.countDocuments(match);
    const cursor = col
      .find(match)
      .project({
        _id: 1,
        textbook: 1,
        source: 1,
        type: 1,
        'question_data.Options': 1,
      })
      .sort({ textbook: 1, source: 1, type: 1 })
      .limit(MAX_RESULTS);

    const docs = await cursor.toArray();

    const items = docs.map((d) => {
      const opt = (d.question_data as Record<string, unknown>)?.Options;
      const str = typeof opt === 'string' ? opt : '';
      const idx = str.toUpperCase().indexOf('API');
      const snippet =
        idx >= 0
          ? (str.slice(Math.max(0, idx - 40), idx + 60) || str.slice(0, 100)).trim()
          : str.slice(0, 100);
      return {
        id: String(d._id),
        textbook: String(d.textbook ?? ''),
        source: String(d.source ?? ''),
        type: String(d.type ?? ''),
        snippet: snippet || '(비어 있음)',
        full: str || '',
      };
    });

    return NextResponse.json({
      ok: true,
      filters: { textbook: textbook || null, type: type || null },
      totalScanned: totalMatched,
      totalMatched,
      items,
      truncated: totalMatched > MAX_RESULTS,
    });
  } catch (e) {
    console.error('validate/options-api:', e);
    return NextResponse.json(
      { error: 'Options API 검증 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
