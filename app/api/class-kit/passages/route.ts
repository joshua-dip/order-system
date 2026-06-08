import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import {
  classKitTextbookDeniedMessage,
  isClassKitTextbookAllowed,
  resolveClassKitAccess,
} from '@/lib/class-kit-access';

/**
 * 사용자용 — 교재명으로 지문 목록 (PassagePicker 이전·다음 이동용).
 * GET /api/class-kit/passages?textbook=<교재명>&limit=<n>
 */
export async function GET(request: NextRequest) {
  const { level } = await resolveClassKitAccess(request);

  const { searchParams } = request.nextUrl;
  const textbook = searchParams.get('textbook')?.trim() || '';
  const limit = Math.min(2000, Math.max(1, parseInt(searchParams.get('limit') || '500', 10) || 500));

  if (!textbook) {
    return NextResponse.json({ error: '교재명(textbook)이 필요합니다.' }, { status: 400 });
  }
  if (!isClassKitTextbookAllowed(textbook, level)) {
    return NextResponse.json({ error: classKitTextbookDeniedMessage(level) }, { status: 403 });
  }

  try {
    const db = await getDb('gomijoshua');
    const items = await db
      .collection('passages')
      .find({ textbook })
      .sort({ chapter: 1, order: 1, number: 1 })
      .limit(limit)
      .project({
        textbook: 1,
        chapter: 1,
        number: 1,
        source_key: 1,
        'content.original': 1,
        'content.sentences_en': 1,
        'content.sentences_ko': 1,
      })
      .toArray();

    const serialized = items.map((d) => {
      const { _id, ...rest } = d as Record<string, unknown>;
      return { ...rest, _id: String(_id) };
    });
    return NextResponse.json({ items: serialized, total: serialized.length });
  } catch (e) {
    console.error('class-kit passages list:', e);
    return NextResponse.json({ error: '조회에 실패했습니다.' }, { status: 500 });
  }
}
