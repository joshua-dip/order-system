import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { practiceViewer } from '@/lib/practice-auth';
import {
  pickPracticeSet,
  questionsFromTokens,
  wrongTokens,
  PRACTICE_KINDS,
  PRACTICE_MAX_SET,
  type PracticeKind,
} from '@/lib/practice-questions';

export const dynamic = 'force-dynamic';

/**
 * 학습실 세트 — 지문 원문에서 즉석 생성(정답·해설 없음). 새 세트는 비회원도, 복습은 회원만.
 *  새 세트: ?textbook=…(없으면 &grade=1~3 학년 전체)&kinds=순서,삽입&count=10
 *  오답 복습: ?review=wrong&count=20   ·   한 문항 다시: ?retry=<id>
 */
export async function GET(request: NextRequest) {
  const me = await practiceViewer(request);
  const sp = request.nextUrl.searchParams;
  /* 복습(오답·한 문항 다시)은 기록이 있는 회원만 */
  if ((sp.get('retry') || sp.get('review')) && !me.member) {
    return NextResponse.json({ error: '오답 복습은 회원만 이용할 수 있습니다.', member: false }, { status: 401 });
  }
  const count = Math.max(1, Math.min(Number(sp.get('count')) || 10, PRACTICE_MAX_SET));
  try {
    const db = await getDb('gomijoshua');
    if (sp.get('retry')) {
      return NextResponse.json({ ok: true, questions: await questionsFromTokens(db, [sp.get('retry') as string]) });
    }
    if (sp.get('review') === 'wrong') {
      const ids = await wrongTokens(db, me.loginId as string, count);
      return NextResponse.json({ ok: true, questions: await questionsFromTokens(db, ids) }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const kinds = (sp.get('kinds') ?? '순서,삽입')
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is PracticeKind => (PRACTICE_KINDS as readonly string[]).includes(s));
    const textbook = (sp.get('textbook') ?? '').trim() || undefined;
    const grade = Number(sp.get('grade')) || undefined;
    if (!kinds.length || (!textbook && !grade)) {
      return NextResponse.json({ error: '회차(또는 학년)와 유형을 골라 주세요.' }, { status: 400 });
    }
    const questions = await pickPracticeSet(db, { textbook, grade, kinds, count });
    return NextResponse.json({ ok: true, questions }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[practice/set]', e);
    return NextResponse.json({ error: '문항을 만들지 못했습니다.' }, { status: 500 });
  }
}
