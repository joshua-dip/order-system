import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/lib/mongodb';

const COL = 'passage_analyzer_assignments';

/** 관리자 단일 모드: 배정 문서는 확장용으로만 저장 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const fileName = request.nextUrl.searchParams.get('fileName')?.trim();
  try {
    const db = await getDb('gomijoshua');
    if (fileName) {
      const doc = await db.collection(COL).findOne({ fileName });
      return NextResponse.json({ success: true, assignment: doc || null });
    }
    const all = await db.collection(COL).find({}).limit(200).toArray();
    return NextResponse.json({ success: true, assignments: all });
  } catch (e) {
    console.error('file-assignments GET:', e);
    return NextResponse.json({ success: false, assignments: [] }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const body = await request.json();
    const fileName = typeof body.fileName === 'string' ? body.fileName.trim() : '';
    if (!fileName) {
      return NextResponse.json({ success: false, message: 'fileName이 필요합니다.' }, { status: 400 });
    }
    const db = await getDb('gomijoshua');
    await db.collection(COL).updateOne(
      { fileName },
      { $set: { ...body, fileName, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true }
    );
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('file-assignments POST:', e);
    return NextResponse.json({ success: false, message: '저장 실패' }, { status: 500 });
  }
}
