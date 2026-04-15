import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { buildLessonGroupsFromPassageRows } from '@/lib/passage-lesson-index';

const MAX_PASSAGES = 4000;

/**
 * 주문 화면(강·번호 선택)용: 병합 converted_data에 없는 교재도 passages 기준으로 목록 제공.
 * 본문 미포함 — textbook·chapter·number 메타만 사용.
 */
export async function GET(request: NextRequest) {
  const textbook = request.nextUrl.searchParams.get('textbook')?.trim() ?? '';
  if (!textbook) {
    return NextResponse.json({ error: 'textbook 파라미터가 필요합니다.' }, { status: 400 });
  }
  if (textbook.length > 200) {
    return NextResponse.json({ error: 'textbook 값이 너무 깁니다.' }, { status: 400 });
  }

  try {
    const db = await getDb('gomijoshua');
    const passages = await db
      .collection('passages')
      .find({ textbook })
      .project({ textbook: 1, chapter: 1, number: 1, order: 1 })
      .sort({ chapter: 1, order: 1, number: 1 })
      .limit(MAX_PASSAGES)
      .toArray();

    const groups = buildLessonGroupsFromPassageRows(
      passages as { textbook?: string; chapter?: string; number?: string }[],
      textbook,
    );

    return NextResponse.json({
      ok: true,
      textbook,
      passageCount: passages.length,
      groups,
    });
  } catch (e) {
    console.error('textbooks/lesson-index:', e);
    return NextResponse.json({ error: '목록을 불러오지 못했습니다.' }, { status: 500 });
  }
}
