import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { practiceMember } from '@/lib/practice-auth';
import { pickPracticeSet, PRACTICE_KINDS, type PracticeKind } from '@/lib/practice-questions';

export const dynamic = 'force-dynamic';

/**
 * 학습실 — 연습 세트. 정답·해설은 싣지 않는다(문항마다 /api/practice/check 로 채점).
 * ?textbook=26년 9월 고1 영어모의고사&kinds=순서,삽입&hard=0&count=10 (count 없으면 전체)
 */
export async function GET(request: NextRequest) {
  if (!(await practiceMember(request))) {
    return NextResponse.json({ error: '회원만 이용할 수 있습니다.', member: false }, { status: 401 });
  }
  const sp = request.nextUrl.searchParams;
  const textbook = (sp.get('textbook') ?? '').trim();
  const kinds = (sp.get('kinds') ?? '순서,삽입')
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is PracticeKind => (PRACTICE_KINDS as readonly string[]).includes(s));
  if (!textbook || kinds.length === 0) {
    return NextResponse.json({ error: '회차와 유형을 골라 주세요.' }, { status: 400 });
  }
  try {
    const db = await getDb('gomijoshua');
    const count = Number(sp.get('count') ?? '');
    const questions = await pickPracticeSet(db, {
      textbook,
      kinds,
      hard: sp.get('hard') === '1',
      limit: Number.isInteger(count) && count > 0 ? count : undefined,
    });
    return NextResponse.json({ ok: true, textbook, questions }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[practice/set]', e);
    return NextResponse.json({ error: '문항을 불러오지 못했습니다.' }, { status: 500 });
  }
}
