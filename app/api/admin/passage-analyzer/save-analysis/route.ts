import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/lib/mongodb';

/** 지문 분석 작업대 저장소 (파일명 = passage 기준 1문서, 최신 상태만 유지) */
const COL = 'passage_analyses';

export async function POST(request: NextRequest) {
  const { error, payload } = await requireAdmin(request);
  if (error) return error;
  if (!payload) return NextResponse.json({ error: '인증 오류' }, { status: 401 });

  try {
    const body = await request.json();
    const fileName = typeof body.fileName === 'string' ? body.fileName.trim() : '';
    const data = body.data && typeof body.data === 'object' ? body.data : null;
    const editorId = payload.sub;
    const editorName = payload.loginId;

    if (!fileName || !data) {
      return NextResponse.json({ error: 'fileName과 data가 필요합니다.' }, { status: 400 });
    }

    const db = await getDb('gomijoshua');
    const now = new Date();
    const query = { fileName };

    const currentDoc = await db.collection(COL).findOne(query);
    const newVersion = Math.floor(Number((currentDoc as { version?: number })?.version) || 0) + 1;

    await db.collection(COL).updateOne(
      query,
      {
        $set: {
          fileName,
          teacherId: null,
          collaborationHostId: null,
          ...data,
          version: newVersion,
          lastEditorId: editorId,
          lastEditorName: editorName,
          lastSaved: now.toISOString(),
          updatedAt: now,
        },
        $setOnInsert: {
          createdAt: now,
        },
      },
      { upsert: true }
    );

    const savedDoc = await db.collection(COL).findOne(query);
    return NextResponse.json({
      success: true,
      message: '저장되었습니다.',
      version: newVersion,
      lastSaved: (savedDoc as { lastSaved?: string })?.lastSaved ?? now.toISOString(),
      lastEditorName: editorName,
    });
  } catch (e) {
    console.error('save-analysis:', e);
    return NextResponse.json({ error: '저장에 실패했습니다.' }, { status: 500 });
  }
}
