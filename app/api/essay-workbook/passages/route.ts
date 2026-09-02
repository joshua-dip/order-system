import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 서술형 워크북 — 한 교재의 지문(번호) 목록과 **유형별** 난도 보유 현황.
 *
 * 유형 판별은 샘플 API 와 같은 기준을 쓴다 — `data.meta.examType` 이 있으면
 * 「글의의미 서술형」, 없으면 「조건영작배열」. 최상위 examType 필드는 전 문서
 * null 이라 쓸 수 없고, meta.title 은 표시용 제목이라 유형과 1:1 이 아니다.
 */
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
            /* 지문 × 유형으로 갈라 담는다 — 한 지문이 두 유형을 다 가질 수 있다. */
            _id: {
              sourceKey: '$sourceKey',
              meaning: { $eq: ['$data.meta.examType', '글의의미서술형'] },
            },
            difficulties: { $addToSet: '$difficulty' },
          },
        },
        { $sort: { '_id.sourceKey': 1 } },
      ])
      .toArray();

    // 「… 23번」 처럼 끝의 숫자를 뽑아 번호 순으로 정렬 (문자열 정렬이면 10번이 2번 앞에 온다)
    const num = (s: string) => {
      const m = s.match(/(\d+)\s*(?:-\s*\d+)?\s*번\s*$/);
      return m ? parseInt(m[1], 10) : 9999;
    };
    /* 갈라 담은 것을 지문 하나로 다시 합친다 — 화면은 지문 단위로 고르기 때문. */
    const byKey = new Map<string, { sourceKey: string; arrange: string[]; meaning: string[] }>();
    for (const r of rows) {
      const id = r._id as { sourceKey?: unknown; meaning?: unknown };
      const sourceKey = String(id.sourceKey ?? '');
      if (!sourceKey) continue;
      const diffs = (r.difficulties as unknown[]).filter(
        (d): d is string => typeof d === 'string' && d !== '',
      );
      const cur = byKey.get(sourceKey) ?? { sourceKey, arrange: [], meaning: [] };
      if (id.meaning === true) cur.meaning = [...cur.meaning, ...diffs];
      else cur.arrange = [...cur.arrange, ...diffs];
      byKey.set(sourceKey, cur);
    }

    const passages = [...byKey.values()]
      .map((p) => ({
        ...p,
        /* 옛 화면 호환 — 조건영작배열 난도를 기본 난도 목록으로 본다. */
        difficulties: p.arrange.length > 0 ? p.arrange : p.meaning,
        isMeaningType: p.meaning.length > 0,
      }))
      .sort((a, b) => num(a.sourceKey) - num(b.sourceKey) || a.sourceKey.localeCompare(b.sourceKey, 'ko'));

    return NextResponse.json({ ok: true, textbook, passages });
  } catch (e) {
    console.error('[essay-workbook passages]', e);
    return NextResponse.json({ ok: true, textbook, passages: [] });
  }
}
