import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { LIVE_PASSAGE_PROJECTION, loadPassageLive } from '@/lib/passage-live-analysis';

export const dynamic = 'force-dynamic';

/** 관리자 클래스키트 「수업 화면」 — 지문 + 지문분석기 결과 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireAdmin(request);
  if (error) return error;
  const { id } = await params;
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 });
  try {
    const db = await getDb('gomijoshua');
    const doc = await db.collection('passages').findOne({ _id: new ObjectId(id) }, { projection: LIVE_PASSAGE_PROJECTION });
    if (!doc) return NextResponse.json({ error: '지문을 찾을 수 없습니다.' }, { status: 404 });
    return NextResponse.json(await loadPassageLive(db, doc as never));
  } catch (e) {
    console.error('admin passage live GET:', e);
    return NextResponse.json({ error: '조회에 실패했습니다.' }, { status: 500 });
  }
}
