import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import path from 'path';
import fs from 'fs/promises';
import { getDb } from '@/lib/mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';

const UPLOAD_DIR = 'uploads/essay-type-examples';

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
 * 서술형 유형 수정
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireAdmin(request);
  if (error) return error;
  const { id } = await params;
  if (!id || !ObjectId.isValid(id)) {
    return NextResponse.json({ error: '유효하지 않은 ID입니다.' }, { status: 400 });
  }
  try {
    const body = await request.json().catch(() => ({}));
    const 대분류 = typeof body?.대분류 === 'string' ? body.대분류.trim() : undefined;
    const 소분류 = typeof body?.소분류 === 'string' ? body.소분류.trim() : undefined;
    const typeCode = typeof body?.typeCode === 'string' ? body.typeCode.trim() || null : undefined;
    const 문제 = typeof body?.문제 === 'string' ? body.문제.trim() || null : undefined;
    let 태그: string[] | null | undefined;
    if (body?.태그 === null) 태그 = null;
    else if (Array.isArray(body?.태그)) {
      태그 = body.태그.filter((t: unknown) => typeof t === 'string').map((t: string) => t.trim()).filter(Boolean);
    } else if (typeof body?.태그 === 'string') {
      태그 = body.태그.split(/[\n,]+/).map((t: string) => t.trim()).filter(Boolean);
    }
    const 조건 = typeof body?.조건 === 'string' ? body.조건.trim() || null : undefined;
    const order = typeof body?.order === 'number' ? body.order : undefined;
    const price = body?.price !== undefined ? (typeof body.price === 'number' && body.price >= 0 ? body.price : null) : undefined;
    const enabled = typeof body?.enabled === 'boolean' ? body.enabled : undefined;
    const common = typeof body?.common === 'boolean' ? body.common : undefined;

    const updates: Record<string, unknown> = {};
    if (대분류 !== undefined) updates.대분류 = 대분류;
    if (소분류 !== undefined) updates.소분류 = 소분류;
    if (typeCode !== undefined) updates.typeCode = typeCode;
    if (문제 !== undefined) updates.문제 = 문제;
    if (태그 !== undefined) updates.태그 = 태그;
    if (조건 !== undefined) updates.조건 = 조건;
    if (price !== undefined) updates.price = price;
    if (order !== undefined) updates.order = order;
    if (enabled !== undefined) updates.enabled = enabled;
    if (common !== undefined) updates.common = common;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: '변경할 내용이 없습니다.' }, { status: 400 });
    }

    const db = await getDb('gomijoshua');
    const result = await db.collection('essayTypes').updateOne(
      { _id: new ObjectId(id) },
      { $set: updates }
    );
    if (result.matchedCount === 0) {
      return NextResponse.json({ error: '해당 유형을 찾을 수 없습니다.' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('서술형 유형 수정 실패:', err);
    return NextResponse.json({ error: '수정에 실패했습니다.' }, { status: 500 });
  }
}

/**
 * 서술형 유형 삭제
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireAdmin(request);
  if (error) return error;
  const { id } = await params;
  if (!id || !ObjectId.isValid(id)) {
    return NextResponse.json({ error: '유효하지 않은 ID입니다.' }, { status: 400 });
  }
  try {
    const db = await getDb('gomijoshua');
    const result = await db.collection('essayTypes').deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) {
      return NextResponse.json({ error: '해당 유형을 찾을 수 없습니다.' }, { status: 404 });
    }
    const rootDir = path.join(process.cwd(), UPLOAD_DIR, id);
    try {
      await fs.rm(rootDir, { recursive: true, force: true });
    } catch { /* 폴더 없으면 무시 */ }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('서술형 유형 삭제 실패:', err);
    return NextResponse.json({ error: '삭제에 실패했습니다.' }, { status: 500 });
  }
}
