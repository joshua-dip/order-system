import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import {
  classKitTextbookDeniedMessage,
  isClassKitTextbookAllowed,
  resolveClassKitAccess,
} from '@/lib/class-kit-access';
import { LIVE_PASSAGE_PROJECTION, loadPassageLive } from '@/lib/passage-live-analysis';

export const dynamic = 'force-dynamic';

/** 사용자 클래스키트 「수업 화면」 — 지문 단건과 같은 접근 규칙(회원=모의고사, 비회원=체험 교재) */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: '잘못된 id 형식입니다.' }, { status: 400 });
  const { level } = await resolveClassKitAccess(request);
  try {
    const db = await getDb('gomijoshua');
    const doc = await db.collection('passages').findOne({ _id: new ObjectId(id) }, { projection: LIVE_PASSAGE_PROJECTION });
    if (!doc) return NextResponse.json({ error: '지문을 찾을 수 없습니다.' }, { status: 404 });
    if (!isClassKitTextbookAllowed(String((doc as { textbook?: unknown }).textbook ?? ''), level)) {
      return NextResponse.json({ error: classKitTextbookDeniedMessage(level) }, { status: 403 });
    }
    return NextResponse.json(await loadPassageLive(db, doc as never));
  } catch (e) {
    console.error('class-kit passage live GET:', e);
    return NextResponse.json({ error: '조회에 실패했습니다.' }, { status: 500 });
  }
}
