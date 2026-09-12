import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { listFreePassages, PUBLIC_FREE_TYPES } from '@/lib/public-free-questions';

/** 공개 — 한 회차의 지문별 보유 유형. 문항 본문은 주지 않는다(PDF 로만 나간다). */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const textbook = (request.nextUrl.searchParams.get('textbook') ?? '').trim();
  if (!textbook) {
    return NextResponse.json({ error: 'textbook 이 필요합니다.' }, { status: 400 });
  }
  const db = await getDb('gomijoshua');
  const passages = await listFreePassages(db, textbook);
  return NextResponse.json({ ok: true, textbook, freeTypes: PUBLIC_FREE_TYPES, passages });
}
