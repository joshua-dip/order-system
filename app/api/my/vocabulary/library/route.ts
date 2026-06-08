import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { listMyVocabularies } from '@/lib/vocabulary-library-store';

export async function GET(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  // 게스트(비로그인) — 빈 라이브러리 반환. 게이트 페이지가 게스트 모드로 모의고사 미리보기를 진행.
  if (!token) return NextResponse.json({ items: [], guest: true });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ items: [], guest: true });

  try {
    const userId = new ObjectId(payload.sub);
    const items = await listMyVocabularies(userId);
    return NextResponse.json({ items });
  } catch (e) {
    console.error('vocabulary/library:', e);
    return NextResponse.json({ error: '목록을 불러오지 못했습니다.' }, { status: 500 });
  }
}
