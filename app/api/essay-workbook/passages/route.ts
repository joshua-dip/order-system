import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { normalizePassageKey } from '@/lib/passage-key-match';
import { ESSAY_MEANING_EXAM_TYPE, ESSAY_MAIN_IDEA_EXAM_TYPE } from '@/app/data/essay-categories';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 서술형 워크북 — 한 교재의 지문(번호) 목록과 **유형별** 난도 보유 현황.
 *
 * 유형 판별은 샘플 API 와 같은 기준을 쓴다 — `data.meta.examType` 이 있으면
 * 「글의의미 서술형」, 없으면 「조건영작배열」. 최상위 examType 필드는 전 문서
 * null 이라 쓸 수 없고, meta.title 은 표시용 제목이라 유형과 1:1 이 아니다.
 *
 * 목록은 **이미 만든 것 ∪ 교재의 원문 지문**이다. 재고가 없어도 주문을 받아
 * 제작하므로, 만든 것만 보여 주면 주문할 길이 막힌다(지금필수 「01강 수능기출」
 * 7건이 그랬다). 두 출처의 키가 자릿수만 다른 경우가 있어(「6~8번」↔「06~08번」)
 * 정규화 키로 맞춰 중복을 막는다.
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
              examType: '$data.meta.examType',
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
    const byKey = new Map<string, { sourceKey: string; arrange: string[]; meaning: string[]; mainidea: string[] }>();
    for (const r of rows) {
      const id = r._id as { sourceKey?: unknown; examType?: unknown };
      const sourceKey = String(id.sourceKey ?? '');
      if (!sourceKey) continue;
      const diffs = (r.difficulties as unknown[]).filter(
        (d): d is string => typeof d === 'string' && d !== '',
      );
      const cur = byKey.get(sourceKey) ?? { sourceKey, arrange: [], meaning: [], mainidea: [] };
      const et = String(id.examType ?? '');
      if (et === ESSAY_MEANING_EXAM_TYPE) cur.meaning = [...cur.meaning, ...diffs];
      else if (et === ESSAY_MAIN_IDEA_EXAM_TYPE) cur.mainidea = [...cur.mainidea, ...diffs];
      else cur.arrange = [...cur.arrange, ...diffs];
      byKey.set(sourceKey, cur);
    }

    /* 아직 아무것도 만들지 않은 지문도 주문할 수 있게 원문 목록을 얹는다. */
    const madeNorm = new Set([...byKey.keys()].map(normalizePassageKey));
    const srcKeys = (await db.collection('passages').distinct('source_key', { textbook })) as unknown[];
    for (const raw of srcKeys) {
      const k = String(raw ?? '').trim();
      if (!k || madeNorm.has(normalizePassageKey(k))) continue;
      byKey.set(k, { sourceKey: k, arrange: [], meaning: [], mainidea: [] });
    }

    const passages = [...byKey.values()]
      .map((p) => ({
        ...p,
        /* 옛 화면 호환 — 조건영작배열 난도를 기본 난도 목록으로 본다. */
        difficulties: p.arrange.length > 0 ? p.arrange : p.meaning.length > 0 ? p.meaning : p.mainidea,
        isMeaningType: p.meaning.length > 0,
      }))
      .sort((a, b) => num(a.sourceKey) - num(b.sourceKey) || a.sourceKey.localeCompare(b.sourceKey, 'ko'));

    return NextResponse.json({ ok: true, textbook, passages });
  } catch (e) {
    console.error('[essay-workbook passages]', e);
    return NextResponse.json({ ok: true, textbook, passages: [] });
  }
}
