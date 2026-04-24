import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { resetMyVocabulary } from '@/lib/vocabulary-library-store';

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: '인증이 만료되었습니다.' }, { status: 401 });

  const { id } = await params;
  try {
    const doc = await resetMyVocabulary(id, new ObjectId(payload.sub));
    if (!doc) return NextResponse.json({ error: '단어장을 찾을 수 없습니다.' }, { status: 404 });
    return NextResponse.json({ ok: true, item: doc });
  } catch (e) {
    console.error('vocabulary/[id]/reset:', e);
    return NextResponse.json({ error: '복원에 실패했습니다.' }, { status: 500 });
  }
}
