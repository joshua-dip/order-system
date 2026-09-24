import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { practiceViewer } from '@/lib/practice-auth';
import { checkPracticeAnswer } from '@/lib/practice-questions';

export const dynamic = 'force-dynamic';

/** 학습실 — 한 문항 채점. 회원이면 기록하고 해설(reveal)까지, 비회원은 정답 여부만. body: { id, answer } */
export async function POST(request: NextRequest) {
  const me = await practiceViewer(request);
  let body: { id?: unknown; answer?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 });
  }
  const id = typeof body.id === 'string' ? body.id : '';
  const answer = typeof body.answer === 'string' ? body.answer : '';
  if (!id || !/^[①-⑤]$/.test(answer)) return NextResponse.json({ error: '문항과 답을 보내 주세요.' }, { status: 400 });
  try {
    const db = await getDb('gomijoshua');
    const result = await checkPracticeAnswer(db, me.loginId, id, answer);
    if (!result) return NextResponse.json({ error: '연습 문항을 찾을 수 없습니다.' }, { status: 404 });
    /* 비회원: 정답 여부·정답 번호만. 해설(원래 글 흐름)은 회원 혜택으로 잠근다 — 가입 유도 */
    const body = me.member ? { ok: true, member: true, ...result } : { ok: true, member: false, correct: result.correct, correctAnswer: result.correctAnswer, reveal: null };
    return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[practice/check]', e);
    return NextResponse.json({ error: '채점하지 못했습니다.' }, { status: 500 });
  }
}
