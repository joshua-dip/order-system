import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { isMockExamTextbookKey } from '@/lib/mock-exam-key';

export const dynamic = 'force-dynamic';

interface PassageItem {
  id: string;
  sourceKey: string | null;
  preview: string;
}

/**
 * GET /api/qna/passages/by-textbook?textbook=...
 *
 * 해당 회차의 지문 목록 (id, source_key, 첫 문장 미리보기).
 * 모의고사 키만 허용 — 일반 교재는 400.
 */
export async function GET(request: NextRequest) {
  const textbook = request.nextUrl.searchParams.get('textbook')?.trim();
  if (!textbook) {
    return NextResponse.json({ error: 'textbook 파라미터가 필요합니다.' }, { status: 400 });
  }
  if (!isMockExamTextbookKey(textbook)) {
    return NextResponse.json({ error: '모의고사 교재만 조회할 수 있습니다.' }, { status: 400 });
  }
  try {
    const db = await getDb('gomijoshua');
    const docs = await db
      .collection('passages')
      .find({ textbook })
      .project({
        source_key: 1,
        'content.original': 1,
        'content.sentences_en': 1,
      })
      .sort({ source_key: 1, chapter: 1, order: 1, number: 1 })
      .toArray();

    const items: PassageItem[] = docs.map((d) => {
      const content = (d.content as { original?: string; sentences_en?: unknown[] }) || {};
      const sentences = Array.isArray(content.sentences_en) ? content.sentences_en.map(String) : [];
      const firstFromArray = sentences.find((s) => s.trim().length > 0)?.trim() || '';
      const firstFromOriginal = !firstFromArray
        ? String(content.original || '').split(/(?<=[.!?])\s+/)[0]?.trim() || ''
        : '';
      const preview = (firstFromArray || firstFromOriginal).slice(0, 140);
      return {
        id: String(d._id),
        sourceKey: (d as { source_key?: string }).source_key ?? null,
        preview,
      };
    });

    // sourceKey 자연 정렬 (숫자 부분을 숫자로 정렬)
    items.sort((a, b) => {
      const ak = a.sourceKey ?? '';
      const bk = b.sourceKey ?? '';
      return ak.localeCompare(bk, 'ko', { numeric: true, sensitivity: 'base' });
    });

    return NextResponse.json({ textbook, items });
  } catch (e) {
    console.error('qna passages by-textbook GET:', e);
    return NextResponse.json({ error: '지문 목록 조회에 실패했습니다.' }, { status: 500 });
  }
}
