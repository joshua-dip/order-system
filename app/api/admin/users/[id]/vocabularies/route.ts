import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { listVocabulariesForAdmin } from '@/lib/vocabulary-library-store';

async function requireAdmin(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) {
    return { error: NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 }), payload: null };
  }
  const payload = await verifyToken(token);
  if (!payload || payload.role !== 'admin') {
    return { error: NextResponse.json({ error: '관리자만 이용할 수 있습니다.' }, { status: 403 }), payload: null };
  }
  return { error: null, payload };
}

/** GET — 해당 회원의 단어장 구매·편집 메타 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { id } = await params;
  if (!id || !ObjectId.isValid(id)) {
    return NextResponse.json({ error: '유효하지 않은 ID입니다.' }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const limitRaw = searchParams.get('limit');
  const skipRaw = searchParams.get('skip');
  const limit = limitRaw ? parseInt(limitRaw, 10) : 100;
  const skip = skipRaw ? parseInt(skipRaw, 10) : 0;

  if (Number.isNaN(limit) || Number.isNaN(skip)) {
    return NextResponse.json({ error: 'limit/skip가 올바르지 않습니다.' }, { status: 400 });
  }

  const userObjectId = new ObjectId(id);
  const { items, total } = await listVocabulariesForAdmin({
    userObjectId,
    limit,
    skip,
  });

  const editedCount = items.filter((i) => i.has_custom_edit).length;
  const pointsOnPage = items.reduce((s, i) => s + i.points_used, 0);

  return NextResponse.json({
    items,
    total,
    pageMeta: { editedCount, pointsOnPage },
  });
}
