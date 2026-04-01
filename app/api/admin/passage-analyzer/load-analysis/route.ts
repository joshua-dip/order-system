import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/lib/mongodb';

const COL = 'passage_analyses';

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const db = await getDb('gomijoshua');
    const analyses = await db
      .collection(COL)
      .find({}, { projection: { fileName: 1, createdAt: 1, updatedAt: 1, lastSaved: 1 } })
      .sort({ updatedAt: -1 })
      .limit(200)
      .toArray();

    const files = analyses.map((a) => ({
      name: (a as { fileName?: string }).fileName,
      createdAt: (a as { createdAt?: Date }).createdAt ?? (a as { lastSaved?: string }).lastSaved,
      modifiedAt: (a as { updatedAt?: Date }).updatedAt ?? (a as { lastSaved?: string }).lastSaved,
      size: 0,
    }));

    return NextResponse.json({ files });
  } catch (e) {
    console.error('load-analysis GET:', e);
    return NextResponse.json({ error: '목록 조회 실패' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const body = await request.json();
    const fileName = typeof body.fileName === 'string' ? body.fileName.trim() : '';
    if (!fileName) {
      return NextResponse.json({ error: 'fileName이 필요합니다.' }, { status: 400 });
    }

    const db = await getDb('gomijoshua');
    const analysis = await db.collection(COL).findOne({ fileName });
    if (!analysis) {
      return NextResponse.json({ error: '파일을 찾을 수 없습니다.' }, { status: 404 });
    }

    const { _id, ...data } = analysis as Record<string, unknown> & { _id: unknown };
    return NextResponse.json({
      success: true,
      data,
      message: '불러왔습니다.',
      lastSaved: (analysis as { lastSaved?: string }).lastSaved,
      lastEditorName: (analysis as { lastEditorName?: string }).lastEditorName,
    });
  } catch (e) {
    console.error('load-analysis POST:', e);
    return NextResponse.json({ error: '불러오기 실패' }, { status: 500 });
  }
}
