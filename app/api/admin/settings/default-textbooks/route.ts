import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';

/**
 * 부교재 기본 노출 교재 설정 저장. 관리자 전용.
 */
export async function GET(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload || payload.role !== 'admin') {
    return NextResponse.json({ error: '관리자 권한이 필요합니다.' }, { status: 403 });
  }
  try {
    const db = await getDb('gomijoshua');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = await db.collection('settings').findOne({ _id: 'defaultTextbooks' } as any);
    const value = Array.isArray(doc?.value) ? doc.value : [];
    return NextResponse.json({ textbookKeys: value });
  } catch (err) {
    console.error('기본 노출 교재 조회 실패:', err);
    return NextResponse.json({ textbookKeys: [] });
  }
}

export async function PUT(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload || payload.role !== 'admin') {
    return NextResponse.json({ error: '관리자 권한이 필요합니다.' }, { status: 403 });
  }
  try {
    const body = await request.json();
    const textbookKeys = Array.isArray(body.textbookKeys)
      ? body.textbookKeys.filter((k: unknown) => typeof k === 'string')
      : [];
    const db = await getDb('gomijoshua');
    await db.collection('settings').updateOne(
      { _id: 'defaultTextbooks' } as any,
      { $set: { value: textbookKeys, updatedAt: new Date() } },
      { upsert: true }
    );
    return NextResponse.json({ ok: true, textbookKeys });
  } catch (err) {
    console.error('기본 노출 교재 저장 실패:', err);
    return NextResponse.json({ error: '저장에 실패했습니다.' }, { status: 500 });
  }
}
