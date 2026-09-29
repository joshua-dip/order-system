import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { loadLiveQuestions } from '@/lib/passage-live-questions';

export const dynamic = 'force-dynamic';

/** 관리자 수업 화면 — 판매 재고(완료)에서 유형별 문항 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireAdmin(request);
  if (error) return error;
  const { id } = await params;
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 });
  try {
    const db = await getDb('gomijoshua');
    return NextResponse.json(await loadLiveQuestions(db, id, 'stock'));
  } catch (e) {
    console.error('admin passage live questions GET:', e);
    return NextResponse.json({ error: '조회에 실패했습니다.' }, { status: 500 });
  }
}
