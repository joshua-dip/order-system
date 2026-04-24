import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import {
  getMyVocabulary,
  saveMyVocabulary,
  softDeleteMyVocabulary,
} from '@/lib/vocabulary-library-store';
import type { VocabularyEntry } from '@/lib/passage-analyzer-types';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: '인증이 만료되었습니다.' }, { status: 401 });

  const { id } = await params;
  try {
    const doc = await getMyVocabulary(id, new ObjectId(payload.sub));
    if (!doc) return NextResponse.json({ error: '단어장을 찾을 수 없습니다.' }, { status: 404 });
    return NextResponse.json({ item: doc });
  } catch (e) {
    console.error('vocabulary/[id] GET:', e);
    return NextResponse.json({ error: '단어장을 불러오지 못했습니다.' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: '인증이 만료되었습니다.' }, { status: 401 });

  const { id } = await params;
  try {
    const body = await request.json();
    const vocabularyList = body?.vocabulary_list;
    if (!Array.isArray(vocabularyList)) {
      return NextResponse.json({ error: 'vocabulary_list 배열이 필요합니다.' }, { status: 400 });
    }
    const ok = await saveMyVocabulary(id, new ObjectId(payload.sub), vocabularyList as VocabularyEntry[]);
    if (!ok) return NextResponse.json({ error: '단어장을 찾을 수 없습니다.' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('vocabulary/[id] PATCH:', e);
    return NextResponse.json({ error: '저장에 실패했습니다.' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: '인증이 만료되었습니다.' }, { status: 401 });

  const { id } = await params;
  try {
    const ok = await softDeleteMyVocabulary(id, new ObjectId(payload.sub));
    if (!ok) return NextResponse.json({ error: '단어장을 찾을 수 없습니다.' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('vocabulary/[id] DELETE:', e);
    return NextResponse.json({ error: '삭제에 실패했습니다.' }, { status: 500 });
  }
}
