import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { syncEssayTypesCollection } from '@/lib/essay-type-config-sync';
import { ESSAY_TYPE_LIST_PROJECTION } from '@/lib/essay-type-example-file';

const essaySort = { 대분류: 1, order: 1, 소분류: 1 } as const;

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
    await syncEssayTypesCollection(coll);
    let list = await coll.find({}, { projection: ESSAY_TYPE_LIST_PROJECTION }).sort(essaySort).toArray();

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
    // 비회원/권한 없음: 공통 유형만 반환 (EBS·모의고사 주문용). 회원(서술형 권한): 공통 + 배정 유형
    const allowedSet = new Set(allowedEssayTypeIds);
    list = list.filter((d: { common?: boolean; _id?: { toString: () => string } }) => {
      const isCommon = (d as { common?: boolean }).common === true || (d as { common?: boolean }).common === undefined;
      if (!canAccessEssay) return isCommon; // 비회원은 공통 유형만
      const idStr = d._id?.toString?.();
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
