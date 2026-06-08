import { NextRequest, NextResponse } from 'next/server';
import { buildTrialVocabularyItems } from '@/lib/vocabulary-library-store';

/**
 * POST /api/public/vocabulary/trial
 * 비회원 체험 — 모의고사 무료 교재 단어장 데이터만 반환 (DB·포인트 없음)
 * body: { textbook: string, items: [{ lesson_label: string }] }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const textbook = typeof body?.textbook === 'string' ? body.textbook.trim() : '';
    const rawItems: unknown[] = Array.isArray(body?.items) ? body.items : [];
    const lessonLabels = rawItems
      .map((i) =>
        typeof i === 'object' && i !== null && typeof (i as Record<string, unknown>).lesson_label === 'string'
          ? String((i as Record<string, unknown>).lesson_label).trim()
          : '',
      )
      .filter(Boolean);

    if (!textbook) {
      return NextResponse.json({ error: '교재명이 필요합니다.' }, { status: 400 });
    }

    const result = await buildTrialVocabularyItems(textbook, lessonLabels);
    if (!result.ok) {
      return NextResponse.json({ error: result.error || '체험 단어장 생성에 실패했습니다.' }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      items: result.items,
      first_id: result.first_id,
      inserted_count: result.items?.length ?? 0,
    });
  } catch (e) {
    console.error('public/vocabulary/trial:', e);
    return NextResponse.json({ error: '체험 단어장 생성 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
