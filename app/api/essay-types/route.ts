import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { ESSAY_CATEGORIES } from '@/app/data/essay-categories';

export interface EssayTypeItem {
  id: string;
  대분류: string;
  소분류: string;
  typeCode?: string;
  문제?: string;
  태그?: string[];
  조건?: string;
  price?: number;
  order?: number;
  createdAt?: string;
}

function toResponseItem(d: { _id: { toString: () => string }; 대분류?: string; 소분류?: string; typeCode?: string; 문제?: string; 태그?: string[]; 조건?: string; price?: number; order?: number; createdAt?: Date }) {
  return {
    id: d._id.toString(),
    대분류: d.대분류 ?? '',
    소분류: d.소분류 ?? '',
    typeCode: d.typeCode,
    문제: d.문제,
    태그: Array.isArray(d.태그) ? d.태그 : undefined,
    조건: d.조건,
    price: typeof d.price === 'number' && d.price >= 0 ? d.price : undefined,
    order: d.order,
    createdAt: d.createdAt?.toISOString?.(),
  };
}

/**
 * 서술형 유형 목록. 비어 있으면 기존 ESSAY_CATEGORIES로 시드 후 반환.
 */
export async function GET() {
  try {
    const db = await getDb('gomijoshua');
    const coll = db.collection('essayTypes');
    let list = await coll.find({}).sort({ 대분류: 1, order: 1, 소분류: 1 }).toArray();

    if (list.length === 0) {
      let order = 0;
      const seed = ESSAY_CATEGORIES.flatMap((cat) =>
        (cat.소분류 || []).map((소) => ({
          대분류: cat.대분류,
          소분류: 소,
          문제: '',
          태그: [] as string[],
          조건: '',
          order: order++,
          createdAt: new Date(),
        }))
      );
      if (seed.length > 0) {
        await coll.insertMany(seed);
        list = await coll.find({}).sort({ 대분류: 1, order: 1, 소분류: 1 }).toArray();
      }
    }

    const items = list.map((d) => toResponseItem(d as Parameters<typeof toResponseItem>[0]));
    items.sort((a, b) => {
      if (a.대분류 !== b.대분류) return (a.대분류 || '').localeCompare(b.대분류 || '');
      const aCode = (a.typeCode || '').trim();
      const bCode = (b.typeCode || '').trim();
      const aHas = !!aCode;
      const bHas = !!bCode;
      if (aHas !== bHas) return aHas ? -1 : 1;
      if (aHas && bHas) return aCode.localeCompare(bCode, undefined, { numeric: true });
      return (a.order ?? 0) - (b.order ?? 0) || (a.소분류 || '').localeCompare(b.소분류 || '');
    });
    return NextResponse.json({ types: items });
  } catch (err) {
    console.error('서술형 유형 조회 실패:', err);
    return NextResponse.json({ error: '조회에 실패했습니다.', types: [] }, { status: 500 });
  }
}
