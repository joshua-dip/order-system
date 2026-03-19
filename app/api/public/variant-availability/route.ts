import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

const MAX_LESSONS = 100;
const MAX_TYPES = 16;
const MAX_MIN = 20;

/**
 * 부교재 변형 주문용: 교재·강(source)·유형별 DB(generated_questions) 건수.
 * 관리자가 입력한 출처(source)가 강 선택 라벨과 같을 때만 강별 ✓가 정확합니다.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const textbook = typeof body.textbook === 'string' ? body.textbook.trim() : '';
    const lessons = Array.isArray(body.lessons)
      ? body.lessons
          .filter((l): l is string => typeof l === 'string')
          .map((l) => l.trim())
          .filter(Boolean)
          .slice(0, MAX_LESSONS)
      : [];
    const types = Array.isArray(body.types)
      ? body.types
          .filter((t): t is string => typeof t === 'string')
          .map((t) => t.trim())
          .filter(Boolean)
          .slice(0, MAX_TYPES)
      : [];
    const minCount = Math.min(
      MAX_MIN,
      Math.max(1, Math.floor(Number(body.minCount) || 3))
    );

    if (!textbook || textbook.length > 200) {
      return NextResponse.json({ error: '교재를 입력해 주세요.' }, { status: 400 });
    }
    if (lessons.length === 0 || types.length === 0) {
      return NextResponse.json({
        ok: true,
        minCount,
        textbook,
        lessons: [],
        types: [],
        comboCounts: {},
        textbookTypeTotals: {},
        typeSummary: [],
        allLessonsAllTypesReady: false,
      });
    }

    const db = await getDb('gomijoshua');
    const col = db.collection('generated_questions');

    const [combo, byType] = await Promise.all([
      col
        .aggregate<{ _id: { s: string; t: string }; n: number }>([
          {
            $match: {
              textbook,
              source: { $in: lessons },
              type: { $in: types },
            },
          },
          { $group: { _id: { s: '$source', t: '$type' }, n: { $sum: 1 } } },
        ])
        .toArray(),
      col
        .aggregate<{ _id: string; n: number }>([
          { $match: { textbook, type: { $in: types } } },
          { $group: { _id: '$type', n: { $sum: 1 } } },
        ])
        .toArray(),
    ]);

    const comboCounts: Record<string, Record<string, number>> = {};
    for (const lesson of lessons) {
      comboCounts[lesson] = {};
      for (const t of types) {
        comboCounts[lesson][t] = 0;
      }
    }
    for (const row of combo) {
      const s = row._id?.s;
      const t = row._id?.t;
      if (typeof s === 'string' && typeof t === 'string' && comboCounts[s]?.[t] !== undefined) {
        comboCounts[s][t] = row.n;
      }
    }

    const textbookTypeTotals: Record<string, number> = {};
    for (const t of types) textbookTypeTotals[t] = 0;
    for (const row of byType) {
      if (typeof row._id === 'string' && textbookTypeTotals[row._id] !== undefined) {
        textbookTypeTotals[row._id] = row.n;
      }
    }

    const typeSummary = types.map((typ) => {
      let readyLessons = 0;
      for (const lesson of lessons) {
        if ((comboCounts[lesson]?.[typ] ?? 0) >= minCount) readyLessons++;
      }
      const total = textbookTypeTotals[typ] ?? 0;
      const needTotal = minCount * lessons.length;
      return {
        type: typ,
        readyLessons,
        totalLessons: lessons.length,
        strictAllReady: readyLessons === lessons.length,
        textbookTotal: total,
        looselyEnough: total >= needTotal,
      };
    });

    const allLessonsAllTypesReady = typeSummary.every((s) => s.strictAllReady);

    return NextResponse.json({
      ok: true,
      minCount,
      textbook,
      lessons,
      types,
      comboCounts,
      textbookTypeTotals,
      typeSummary,
      allLessonsAllTypesReady,
    });
  } catch (e) {
    console.error('variant-availability:', e);
    return NextResponse.json({ error: '조회에 실패했습니다.' }, { status: 500 });
  }
}
