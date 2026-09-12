import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { listFreeExams, PUBLIC_FREE_TYPES } from '@/lib/public-free-questions';

/**
 * 공개 — 무료 배포 세트가 있는 회차 목록. 로그인 없이 누구나 호출한다.
 *
 * `public_free_questions` 의 `완료` 만 센다. 판매 재고(`generated_questions`)는
 * 이 경로로 절대 나가지 않는다.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const db = await getDb('gomijoshua');
  const exams = await listFreeExams(db);
  return NextResponse.json({ ok: true, freeTypes: PUBLIC_FREE_TYPES, exams });
}
