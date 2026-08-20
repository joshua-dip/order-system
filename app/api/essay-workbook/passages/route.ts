import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 서술형 워크북 — 한 교재의 지문(번호) 목록과 난도별 보유 현황 */
export async function GET(request: NextRequest) {
  const textbook = (request.nextUrl.searchParams.get('textbook') ?? '').trim();
  if (!textbook) return NextResponse.json({ ok: false, error: '교재를 지정해 주세요.' }, { status: 400 });

  try {
    const db = await getDb('gomijoshua');
    const rows = await db
      .collection('essay_exams')
      .aggregate([
        { $match: { isPlaceholder: { $ne: true }, textbook } },
        {
          $group: {
            _id: '$sourceKey',
            difficulties: { $addToSet: '$difficulty' },
            examTypes: { $addToSet: '$data.meta.examType' },
          },
        },
        { $sort: { _id: 1 } },
      ])
      .toArray();

    // 「… 23번」 처럼 끝의 숫자를 뽑아 번호 순으로 정렬 (문자열 정렬이면 10번이 2번 앞에 온다)
    const num = (s: string) => {
      const m = s.match(/(\d+)\s*(?:-\s*\d+)?\s*번\s*$/);
      return m ? parseInt(m[1], 10) : 9999;
    };
    const passages = rows
      .map((r) => ({
        sourceKey: String(r._id),
        difficulties: (r.difficulties as unknown[]).filter((d): d is string => typeof d === 'string' && d !== ''),
        isMeaningType: (r.examTypes as unknown[]).includes('글의의미서술형'),
      }))
      .sort((a, b) => num(a.sourceKey) - num(b.sourceKey) || a.sourceKey.localeCompare(b.sourceKey, 'ko'));

    return NextResponse.json({ ok: true, textbook, passages });
  } catch (e) {
    console.error('[essay-workbook passages]', e);
    return NextResponse.json({ ok: true, textbook, passages: [] });
  }
}
