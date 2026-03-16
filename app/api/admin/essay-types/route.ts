import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';

async function requireAdmin(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return { error: NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 }), payload: null };
  const payload = await verifyToken(token);
  if (!payload || payload.role !== 'admin') {
    return { error: NextResponse.json({ error: '관리자만 이용할 수 있습니다.' }, { status: 403 }), payload: null };
  }
  return { error: null, payload };
}

/**
 * 서술형 유형 목록 (관리자)
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;
  try {
    const db = await getDb('gomijoshua');
    const list = await db.collection('essayTypes').find({}).sort({ 대분류: 1, order: 1, 소분류: 1 }).toArray();
    const types = list.map((d: { _id: ObjectId; 대분류?: string; 소분류?: string; typeCode?: string; 문제?: string; 태그?: string[]; 조건?: string; price?: number; order?: number; enabled?: boolean; common?: boolean; exampleFile?: { originalName: string; savedPath: string }; createdAt?: Date }) => ({
      id: d._id.toString(),
      대분류: d.대분류 ?? '',
      소분류: d.소분류 ?? '',
      typeCode: d.typeCode,
      문제: d.문제,
      태그: Array.isArray(d.태그) ? d.태그 : undefined,
      조건: d.조건,
      price: typeof d.price === 'number' && d.price >= 0 ? d.price : undefined,
      order: d.order,
      enabled: d.enabled !== false,
      common: d.common === true,
      exampleFile: d.exampleFile ? { originalName: d.exampleFile.originalName, savedPath: d.exampleFile.savedPath } : undefined,
      createdAt: d.createdAt?.toISOString?.(),
    }));
    types.sort((a: { 대분류: string; typeCode?: string; order?: number; 소분류: string }, b: { 대분류: string; typeCode?: string; order?: number; 소분류: string }) => {
      if (a.대분류 !== b.대분류) return (a.대분류 || '').localeCompare(b.대분류 || '');
      const aCode = (a.typeCode || '').trim();
      const bCode = (b.typeCode || '').trim();
      const aHas = !!aCode;
      const bHas = !!bCode;
      if (aHas !== bHas) return aHas ? -1 : 1;
      if (aHas && bHas) return aCode.localeCompare(bCode, undefined, { numeric: true });
      return (a.order ?? 0) - (b.order ?? 0) || (a.소분류 || '').localeCompare(b.소분류 || '');
    });
    return NextResponse.json({ types });
  } catch (err) {
    console.error('서술형 유형 조회 실패:', err);
    return NextResponse.json({ error: '조회에 실패했습니다.' }, { status: 500 });
  }
}

/**
 * 서술형 유형 추가
 */
export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;
  try {
    const body = await request.json().catch(() => ({}));
    const 대분류 = typeof body?.대분류 === 'string' ? body.대분류.trim() : '';
    const 소분류 = typeof body?.소분류 === 'string' ? body.소분류.trim() : '';
    if (!대분류 || !소분류) {
      return NextResponse.json({ error: '대분류와 소분류를 입력해 주세요.' }, { status: 400 });
    }
    const typeCode = typeof body?.typeCode === 'string' ? body.typeCode.trim() || undefined : undefined;
    const 문제 = typeof body?.문제 === 'string' ? body.문제.trim() || undefined : undefined;
    let 태그: string[] | undefined;
    if (Array.isArray(body?.태그)) {
      태그 = body.태그.filter((t: unknown) => typeof t === 'string').map((t: string) => t.trim()).filter(Boolean);
    } else if (typeof body?.태그 === 'string') {
      태그 = body.태그.split(/[\n,]+/).map((t: string) => t.trim()).filter(Boolean);
    }
    const 조건 = typeof body?.조건 === 'string' ? body.조건.trim() || undefined : undefined;
    const order = typeof body?.order === 'number' ? body.order : undefined;
    const price = typeof body?.price === 'number' && body.price >= 0 ? body.price : undefined;

    const db = await getDb('gomijoshua');
    const coll = db.collection('essayTypes');
    const last = await coll.find({ 대분류 }).sort({ order: -1 }).limit(1).next();
    const maxOrder = (last as { order?: number } | null)?.order ?? -1;
    const doc = {
      대분류,
      소분류,
      typeCode,
      문제,
      태그: 태그?.length ? 태그 : undefined,
      조건,
      price,
      order: order ?? maxOrder + 1,
      enabled: true,
      common: false,
      createdAt: new Date(),
    };
    const result = await coll.insertOne(doc);
    return NextResponse.json({
      ok: true,
      id: result.insertedId.toString(),
      type: { id: result.insertedId.toString(), 대분류, 소분류, typeCode, 문제, 태그, 조건, price, order: doc.order },
    });
  } catch (err) {
    console.error('서술형 유형 추가 실패:', err);
    return NextResponse.json({ error: '추가에 실패했습니다.' }, { status: 500 });
  }
}

/**
 * 대분류 전체 삭제 (해당 대분류에 속한 모든 유형 삭제)
 * DELETE /api/admin/essay-types?대분류=단어 배열 영작
 */
export async function DELETE(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;
  const 대분류 = request.nextUrl.searchParams.get('대분류')?.trim();
  if (!대분류) {
    return NextResponse.json({ error: '대분류를 지정해 주세요.' }, { status: 400 });
  }
  try {
    const db = await getDb('gomijoshua');
    const result = await db.collection('essayTypes').deleteMany({ 대분류 });
    return NextResponse.json({ ok: true, deletedCount: result.deletedCount });
  } catch (err) {
    console.error('대분류 삭제 실패:', err);
    return NextResponse.json({ error: '삭제에 실패했습니다.' }, { status: 500 });
  }
}
