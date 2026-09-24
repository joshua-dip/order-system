import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { practiceMember } from '@/lib/practice-auth';
import { listPracticeExams } from '@/lib/practice-questions';

export const dynamic = 'force-dynamic';

/** 학습실 — 순서·삽입 연습이 가능한 모의고사 회차 목록 (회원 전용) */
export async function GET(request: NextRequest) {
  if (!(await practiceMember(request))) {
    return NextResponse.json({ error: '회원만 이용할 수 있습니다.', member: false }, { status: 401 });
  }
  try {
    const db = await getDb('gomijoshua');
    return NextResponse.json({ ok: true, exams: await listPracticeExams(db) });
  } catch (e) {
    console.error('[practice/exams]', e);
    return NextResponse.json({ error: '회차를 불러오지 못했습니다.' }, { status: 500 });
  }
}
