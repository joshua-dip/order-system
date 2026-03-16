import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
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
  exampleFile?: { originalName: string };
  createdAt?: string;
}

function toResponseItem(d: { _id: { toString: () => string }; 대분류?: string; 소분류?: string; typeCode?: string; 문제?: string; 태그?: string[]; 조건?: string; price?: number; order?: number; exampleFile?: { originalName: string }; createdAt?: Date }) {
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
    exampleFile: d.exampleFile ? { originalName: d.exampleFile.originalName } : undefined,
    createdAt: d.createdAt?.toISOString?.(),
  };
}

/**
 * 서술형 유형 목록. 로그인한 서술형 권한 선생님에게만 반환.
 * - 공통유형(common): 모든 서술형 선생님에게 표시
 * - 그 외: 해당 선생님에게 추가 배정된 경우만 표시
 */
export async function GET(request: NextRequest) {
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
          enabled: true,
          common: true,
          createdAt: new Date(),
        }))
      );
      if (seed.length > 0) {
        await coll.insertMany(seed);
        list = await coll.find({}).sort({ 대분류: 1, order: 1, 소분류: 1 }).toArray();
      }
    }

    // 주문서 노출 + 로그인한 서술형 선생님 기준으로 공통/배정 유형만
    list = list.filter((d) => (d as { enabled?: boolean }).enabled !== false);

    const token = request.cookies.get(COOKIE_NAME)?.value;
    const payload = token ? await verifyToken(token) : null;
    let allowedEssayTypeIds: string[] = [];
    let canAccessEssay = false;
    if (payload?.sub) {
      const user = await db.collection('users').findOne(
        { _id: new ObjectId(payload.sub) },
        { projection: { canAccessEssay: 1, allowedEssayTypeIds: 1 } }
      );
      canAccessEssay = !!user?.canAccessEssay;
      allowedEssayTypeIds = Array.isArray(user?.allowedEssayTypeIds) ? user.allowedEssayTypeIds : [];
    }
    if (!canAccessEssay) {
      return NextResponse.json({ types: [] });
    }
    const allowedSet = new Set(allowedEssayTypeIds);
    list = list.filter((d: { common?: boolean; _id?: { toString: () => string } }) => {
      const idStr = d._id?.toString?.();
      const isCommon = d.common === true || d.common === undefined; // 기존 문서(common 없음)는 공통으로 간주
      return isCommon || (idStr && allowedSet.has(idStr));
    });

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
