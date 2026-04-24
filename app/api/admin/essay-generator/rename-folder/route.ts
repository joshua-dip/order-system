import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/essay-generator/rename-folder
 * body: { oldName: string, newName: string }
 * 
 * 해당 폴더의 모든 essay_exams 문서의 folder 필드를 업데이트
 */
export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  let body: { oldName?: string; newName?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 });
  }

  const { oldName, newName } = body;
  if (!oldName || !oldName.trim() || !newName || !newName.trim()) {
    return NextResponse.json({ error: '폴더 이름이 필요합니다.' }, { status: 400 });
  }

  const trimmedOld = oldName.trim();
  const trimmedNew = newName.trim();

  if (trimmedOld === trimmedNew) {
    return NextResponse.json({ error: '동일한 이름입니다.' }, { status: 400 });
  }

  try {
    const db = await getDb('gomijoshua');
    const collection = db.collection('essay_exams');

    // 새 이름으로 이미 존재하는지 확인
    const existing = await collection.findOne({ folder: trimmedNew });
    if (existing) {
      return NextResponse.json({ error: '이미 존재하는 폴더 이름입니다.' }, { status: 400 });
    }

    // 폴더명 일괄 변경
    const result = await collection.updateMany(
      { folder: trimmedOld },
      { $set: { folder: trimmedNew, updatedAt: new Date() } }
    );

    return NextResponse.json({
      ok: true,
      updated: result.modifiedCount,
    });
  } catch (err) {
    console.error('[rename-folder]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '폴더 이름 변경 실패' },
      { status: 500 }
    );
  }
}
