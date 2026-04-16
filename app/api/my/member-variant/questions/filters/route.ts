import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { MEMBER_GENERATED_QUESTIONS_COLLECTION } from '@/lib/member-variant-storage';
import { requirePremiumMemberVariant } from '@/lib/member-variant-premium-auth';

const EMPTY_MARKER = '__none__';

function sortKo(a: string, b: string): number {
  return a.localeCompare(b, 'ko');
}

function cleanDistinct(arr: unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of arr) {
    if (v == null) continue;
    const s = String(v).trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  out.sort(sortKo);
  return out;
}

function textbookScopeFilter(
  base: Record<string, unknown>,
  textbookParam: string
): Record<string, unknown> {
  if (textbookParam === EMPTY_MARKER) {
    return {
      ...base,
      $or: [{ textbook: { $exists: false } }, { textbook: null }, { textbook: '' }],
    };
  }
  return { ...base, textbook: textbookParam };
}

export async function GET(request: NextRequest) {
  const auth = await requirePremiumMemberVariant(request);
  if (!auth.ok) return auth.response;

  const base = { ownerUserId: auth.userId };
  const textbookQ = request.nextUrl.searchParams.get('textbook')?.trim() ?? '';

  try {
    const db = await getDb('gomijoshua');
    const col = db.collection(MEMBER_GENERATED_QUESTIONS_COLLECTION);

    /** 교재가 정해졌을 때 출처 목록만 (드롭다운 연동) */
    if (textbookQ) {
      const match = textbookScopeFilter(base, textbookQ);
      const [sources, emptySource] = await Promise.all([
        col.distinct('source', match),
        col.countDocuments({
          ...match,
          $or: [{ source: { $exists: false } }, { source: null }, { source: '' }],
        }),
      ]);
      return NextResponse.json({
        ok: true,
        scoped: true,
        sources: cleanDistinct(sources),
        hasEmptySource: emptySource > 0,
      });
    }

    const [textbooks, sources, statuses, difficulties, emptyTextbook, emptySource] = await Promise.all([
      col.distinct('textbook', base),
      col.distinct('source', base),
      col.distinct('status', base),
      col.distinct('difficulty', base),
      col.countDocuments({
        ...base,
        $or: [{ textbook: { $exists: false } }, { textbook: null }, { textbook: '' }],
      }),
      col.countDocuments({
        ...base,
        $or: [{ source: { $exists: false } }, { source: null }, { source: '' }],
      }),
    ]);

    return NextResponse.json({
      ok: true,
      scoped: false,
      textbooks: cleanDistinct(textbooks),
      sources: cleanDistinct(sources),
      statuses: cleanDistinct(statuses),
      difficulties: cleanDistinct(difficulties),
      hasEmptyTextbook: emptyTextbook > 0,
      hasEmptySource: emptySource > 0,
    });
  } catch (e) {
    console.error('member-variant questions filters:', e);
    return NextResponse.json({ error: '필터 목록을 불러오지 못했습니다.' }, { status: 500 });
  }
}
