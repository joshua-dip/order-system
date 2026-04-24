import { NextRequest, NextResponse } from 'next/server';
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

/** GET — 전 회원 단어장 구매·편집 메타 (검색·페이지) */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { searchParams } = new URL(request.url);
  const loginId = searchParams.get('loginId') ?? undefined;
  const limitRaw = searchParams.get('limit');
  const skipRaw = searchParams.get('skip');
  const limit = limitRaw ? parseInt(limitRaw, 10) : 50;
  const skip = skipRaw ? parseInt(skipRaw, 10) : 0;

  if (Number.isNaN(limit) || Number.isNaN(skip)) {
    return NextResponse.json({ error: 'limit/skip가 올바르지 않습니다.' }, { status: 400 });
  }

  const { items, total } = await listVocabulariesForAdmin({
    loginIdContains: loginId,
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
