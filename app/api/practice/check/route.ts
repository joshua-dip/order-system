import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { practiceMember } from '@/lib/practice-auth';
import { checkPracticeAnswer } from '@/lib/practice-questions';

export const dynamic = 'force-dynamic';

/** 학습실 — 한 문항 채점. body: { id, answer: '①'~'⑤' } → { correct, correctAnswer, explanation } */
export async function POST(request: NextRequest) {
  if (!(await practiceMember(request))) {
    return NextResponse.json({ error: '회원만 이용할 수 있습니다.', member: false }, { status: 401 });
  }
  let body: { id?: unknown; answer?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 });
  }
  const id = typeof body.id === 'string' ? body.id : '';
  const answer = typeof body.answer === 'string' ? body.answer : '';
  if (!id || !answer) return NextResponse.json({ error: '문항과 답을 보내 주세요.' }, { status: 400 });
  try {
    const db = await getDb('gomijoshua');
    const result = await checkPracticeAnswer(db, id, answer);
    if (!result) return NextResponse.json({ error: '연습 문항이 아닙니다.' }, { status: 404 });
    return NextResponse.json({ ok: true, ...result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[practice/check]', e);
    return NextResponse.json({ error: '채점하지 못했습니다.' }, { status: 500 });
  }
}
