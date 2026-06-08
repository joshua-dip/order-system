import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/lib/mongodb';

/**
 * converted_data (병합 교재 트리)에 이미 반영된 교재 목록을 반환합니다.
 * `passage-upload/from-passages` 가 만든 트리 구조에서 강·번호 개수를 직접 계산합니다.
 *
 * 응답: { textbooks: { textbook, lessonCount, passageCount }[]; updatedAt: string | null }
 */
export async function GET(_req: NextRequest) {
  const { error } = await requireAdmin(_req);
  if (error) return error;

  try {
    const db = await getDb('gomijoshua');
    const doc = await db
      .collection('converted_textbook_json')
      .findOne<{ data?: unknown; updatedAt?: Date }>({ key: 'merged' });

    const data = (doc?.data && typeof doc.data === 'object' && !Array.isArray(doc.data)
      ? (doc.data as Record<string, unknown>)
      : {});

    const textbooks: { textbook: string; lessonCount: number; passageCount: number }[] = [];
    for (const [textbook, entry] of Object.entries(data)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const e = entry as Record<string, unknown>;
      const sheet = (e.Sheet1 ?? e['지문 데이터']) as Record<string, unknown> | undefined;
      const bu = (sheet?.부교재 ?? e.부교재) as Record<string, unknown> | undefined;
      if (!bu || typeof bu !== 'object') continue;
      const tb = (bu as Record<string, unknown>)[textbook];
      if (!tb || typeof tb !== 'object' || Array.isArray(tb)) continue;

      let lessonCount = 0;
      let passageCount = 0;
      for (const lessonNums of Object.values(tb as Record<string, unknown>)) {
        if (!Array.isArray(lessonNums)) continue;
        const nums = lessonNums.filter(
          (it) =>
            it &&
            typeof it === 'object' &&
            String((it as { 번호?: unknown }).번호 ?? '').trim().length > 0,
        );
        if (nums.length === 0) continue;
        lessonCount += 1;
        passageCount += nums.length;
      }
      if (lessonCount > 0) textbooks.push({ textbook, lessonCount, passageCount });
    }

    textbooks.sort((a, b) => a.textbook.localeCompare(b.textbook, 'ko'));

    const updatedAt = doc?.updatedAt instanceof Date ? doc.updatedAt.toISOString() : null;
    return NextResponse.json({ textbooks, updatedAt });
  } catch (e) {
    console.error('passage-upload/reflected:', e);
    return NextResponse.json({ error: '반영 목록 조회 실패' }, { status: 500 });
  }
}
