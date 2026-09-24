import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { listPracticeExams } from '@/lib/practice-questions';

export const dynamic = 'force-dynamic';

/** 학습실 — 순서·삽입 연습이 가능한 모의고사 회차 목록 (비회원도) */
export async function GET(_request: NextRequest) {
  try {
    const db = await getDb('gomijoshua');
    return NextResponse.json({ ok: true, exams: await listPracticeExams(db) });
  } catch (e) {
    console.error('[practice/exams]', e);
    return NextResponse.json({ error: '회차를 불러오지 못했습니다.' }, { status: 500 });
  }
}
