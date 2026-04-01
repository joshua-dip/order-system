import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/lib/mongodb';

const COL = 'passage_analyzer_file_folders';

export async function GET(request: NextRequest) {
  const { error, payload } = await requireAdmin(request);
  if (error) return error;

  const userId = request.nextUrl.searchParams.get('userId')?.trim() || payload?.loginId || '';
  if (!userId) {
    return NextResponse.json({ success: false, message: 'userId가 필요합니다.' }, { status: 400 });
  }

  try {
    const db = await getDb('gomijoshua');
    const items = await db.collection(COL).find({ userId }).toArray();
    const map: Record<string, string> = {};
    for (const it of items) {
      map[(it as { fileName?: string }).fileName || ''] = String((it as { folderId?: string }).folderId || '');
    }
    return NextResponse.json({ success: true, assignments: map });
  } catch (e) {
    console.error('file-folders GET:', e);
    return NextResponse.json({ success: false, message: '조회 실패' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const { error, payload } = await requireAdmin(request);
  if (error) return error;

  try {
    const body = await request.json();
    const userId = (typeof body.userId === 'string' && body.userId.trim()) || payload?.loginId || '';
    const fileName = typeof body.fileName === 'string' ? body.fileName.trim() : '';
    const folderId = typeof body.folderId === 'string' ? body.folderId.trim() : '';
    if (!userId || !fileName) {
      return NextResponse.json({ success: false, message: 'userId와 fileName이 필요합니다.' }, { status: 400 });
    }

    const db = await getDb('gomijoshua');
    await db.collection(COL).updateOne(
      { userId, fileName },
      {
        $set: { userId, fileName, folderId: folderId || null, updatedAt: new Date() },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true }
    );
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('file-folders POST:', e);
    return NextResponse.json({ success: false, message: '저장 실패' }, { status: 500 });
  }
}
