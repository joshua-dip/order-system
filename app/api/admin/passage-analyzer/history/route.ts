import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/lib/mongodb';

const COL = 'passage_analyses';
const HIST = 'passage_analyses_history';

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const fileName = request.nextUrl.searchParams.get('fileName')?.trim() || '';
  if (!fileName) {
    return NextResponse.json({ success: false, error: 'fileName이 필요합니다.' }, { status: 400 });
  }

  try {
    const db = await getDb('gomijoshua');
    const currentDoc = await db.collection(COL).findOne({ fileName });
    const history = await db
      .collection(HIST)
      .find({ fileName })
      .sort({ createdAt: -1 })
      .limit(10)
      .toArray();

    return NextResponse.json({
      success: true,
      current: currentDoc
        ? {
            version: Math.floor(Number((currentDoc as { version?: number }).version) || 1),
            editorName: (currentDoc as { lastEditorName?: string }).lastEditorName ?? '알 수 없음',
            editorId: (currentDoc as { lastEditorId?: string }).lastEditorId,
            savedAt: (currentDoc as { updatedAt?: Date }).updatedAt ?? (currentDoc as { lastSaved?: string }).lastSaved,
          }
        : null,
      history: history.map((h) => ({
        _id: String(h._id),
        version: Math.floor(Number((h as { version?: number }).version) || 1),
        editorName: (h as { editorName?: string }).editorName ?? '알 수 없음',
        editorId: (h as { editorId?: string }).editorId,
        savedAt: (h as { savedAt?: Date }).savedAt,
      })),
    });
  } catch (e) {
    console.error('history GET:', e);
    return NextResponse.json({ success: false, error: '히스토리 조회 실패' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const { error, payload } = await requireAdmin(request);
  if (error) return error;

  try {
    const body = await request.json();
    const fileName = typeof body.fileName === 'string' ? body.fileName.trim() : '';
    const historyId = typeof body.historyId === 'string' ? body.historyId.trim() : '';
    if (!fileName || !historyId || !ObjectId.isValid(historyId)) {
      return NextResponse.json({ success: false, error: 'fileName과 historyId가 필요합니다.' }, { status: 400 });
    }

    const db = await getDb('gomijoshua');
    const now = new Date();
    const historyDoc = await db.collection(HIST).findOne({
      _id: new ObjectId(historyId),
      fileName,
    });

    if (!historyDoc) {
      return NextResponse.json({ success: false, error: '해당 버전을 찾을 수 없습니다.' }, { status: 404 });
    }

    const currentDoc = await db.collection(COL).findOne({ fileName });
    if (currentDoc) {
      await db.collection(HIST).insertOne({
        fileName,
        version: Math.floor(Number((currentDoc as { version?: number }).version) || 1),
        passageStates: (currentDoc as { passageStates?: unknown }).passageStates,
        editorId: (currentDoc as { lastEditorId?: string }).lastEditorId,
        editorName: (currentDoc as { lastEditorName?: string }).lastEditorName ?? '알 수 없음',
        savedAt: (currentDoc as { updatedAt?: Date }).updatedAt,
        createdAt: now,
        restoredFrom: (historyDoc as { version?: number }).version,
      });
    }

    const newVersion = Math.floor(Number((currentDoc as { version?: number })?.version) || 0) + 1;
    await db.collection(COL).updateOne(
      { fileName },
      {
        $set: {
          passageStates: (historyDoc as { passageStates?: unknown }).passageStates,
          version: newVersion,
          lastEditorId: payload?.sub ?? null,
          lastEditorName: `${payload?.loginId ?? 'admin'} (복원 v${(historyDoc as { version?: number }).version})`,
          lastSaved: now.toISOString(),
          updatedAt: now,
        },
      }
    );

    return NextResponse.json({
      success: true,
      message: `버전 ${(historyDoc as { version?: number }).version}으로 복원되었습니다.`,
      newVersion,
    });
  } catch (e) {
    console.error('history POST:', e);
    return NextResponse.json({ success: false, error: '복원 실패' }, { status: 500 });
  }
}
