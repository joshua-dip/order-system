import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';

async function requireAdmin(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return { error: NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 }), payload: null };
  const payload = await verifyToken(token);
  if (payload?.role !== 'admin') {
    return { error: NextResponse.json({ error: '관리자만 이용할 수 있습니다.' }, { status: 403 }), payload: null };
  }
  return { error: null, payload };
}

/**
 * 서술형 대분류별 지문당 가격 일괄 설정 (해당 대분류 하위 모든 유형에 동일 가격 적용)
 */
export async function PUT(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;
  try {
    const body = await request.json().catch(() => ({}));
    const 대분류 = typeof body?.대분류 === 'string' ? body.대분류.trim() : '';
    const price = typeof body?.price === 'number' && body.price >= 0 ? body.price : null;
    if (!대분류) {
      return NextResponse.json({ error: '대분류를 입력해 주세요.' }, { status: 400 });
    }
    if (price === null) {
      return NextResponse.json({ error: '유효한 지문당 가격(0 이상)을 입력해 주세요.' }, { status: 400 });
    }
    const db = await getDb('gomijoshua');
    const result = await db.collection('essayTypes').updateMany(
      { 대분류 },
      { $set: { price } }
    );
    return NextResponse.json({ ok: true, matchedCount: result.matchedCount });
  } catch (err) {
    console.error('대분류 가격 일괄 수정 실패:', err);
    return NextResponse.json({ error: '수정에 실패했습니다.' }, { status: 500 });
  }
}

/**
 * 서술형 대분류 이름 변경 (해당 대분류 하위 모든 유형의 대분류 필드 일괄 수정)
 */
export async function PATCH(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;
  try {
    const body = await request.json().catch(() => ({}));
    const 대분류 = typeof body?.대분류 === 'string' ? body.대분류.trim() : '';
    const new대분류 = typeof body?.new대분류 === 'string' ? body.new대분류.trim() : '';
    if (!대분류) {
      return NextResponse.json({ error: '현재 대분류를 입력해 주세요.' }, { status: 400 });
    }
    if (!new대분류) {
      return NextResponse.json({ error: '변경할 대분류 이름을 입력해 주세요.' }, { status: 400 });
    }
    if (대분류 === new대분류) {
      return NextResponse.json({ error: '변경할 이름이 현재와 같습니다.' }, { status: 400 });
    }
    const db = await getDb('gomijoshua');
    const result = await db.collection('essayTypes').updateMany(
      { 대분류 },
      { $set: { 대분류: new대분류 } }
    );
    return NextResponse.json({ ok: true, matchedCount: result.matchedCount });
  } catch (err) {
    console.error('대분류 이름 변경 실패:', err);
    return NextResponse.json({ error: '수정에 실패했습니다.' }, { status: 500 });
  }
}
