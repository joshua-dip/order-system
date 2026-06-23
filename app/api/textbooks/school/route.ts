import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { buildSchoolTextbooksData } from '@/lib/school-textbooks';

/**
 * 교과서 교재 목록 + 트리. 교과서 주문 허용(canOrderSchoolTextbook) 회원에게만 제공.
 * 비로그인/비권한이면 빈 결과 → UnifiedOrder 교과서 카테고리가 비어 있게 된다.
 */
export async function GET(request: NextRequest) {
  const empty = { keys: [] as string[], data: {} as Record<string, unknown> };
  try {
    const token = request.cookies.get(COOKIE_NAME)?.value;
    const payload = token ? await verifyToken(token) : null;
    if (!payload) return NextResponse.json(empty);

    const db = await getDb('gomijoshua');
    const user = await db
      .collection('users')
      .findOne({ _id: new ObjectId(payload.sub) }, { projection: { canOrderSchoolTextbook: 1 } });
    if (!user?.canOrderSchoolTextbook) return NextResponse.json(empty);

    const result = await buildSchoolTextbooksData(db);
    return NextResponse.json(result);
  } catch (e) {
    console.error('교과서 교재 로드 실패:', e);
    return NextResponse.json(empty);
  }
}
