import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/lib/mongodb';

const COL = 'passage_analyses';
const HIST = 'passage_analyses_history';

export async function POST(request: NextRequest) {
  const { error, payload } = await requireAdmin(request);
  if (error) return error;
  if (!payload) return NextResponse.json({ error: '인증 오류' }, { status: 401 });

  try {
    const body = await request.json();
    const fileName = typeof body.fileName === 'string' ? body.fileName.trim() : '';
    const data = body.data && typeof body.data === 'object' ? body.data : null;
    const createHistory = Boolean(body.createHistory);
    const editorId = payload.sub;
    const editorName = payload.loginId;

    if (!fileName || !data) {
      return NextResponse.json({ error: 'fileName과 data가 필요합니다.' }, { status: 400 });
    }

    const db = await getDb('gomijoshua');
    const now = new Date();
    const query = { fileName };

    const currentDoc = await db.collection(COL).findOne(query);

    if (createHistory && currentDoc) {
      const lastHistory = await db
        .collection(HIST)
        .findOne({ fileName }, { sort: { createdAt: -1 } });
      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
      const shouldCreateHistory =
        !lastHistory || new Date((lastHistory as { createdAt?: Date }).createdAt || 0) < fiveMinutesAgo;

      if (shouldCreateHistory) {
        await db.collection(HIST).insertOne({
          fileName,
          version: Math.floor(Number((currentDoc as { version?: number }).version) || 1),
          passageStates: (currentDoc as { passageStates?: unknown }).passageStates,
          editorId: (currentDoc as { lastEditorId?: string }).lastEditorId ?? null,
          editorName: (currentDoc as { lastEditorName?: string }).lastEditorName ?? '알 수 없음',
          savedAt: (currentDoc as { updatedAt?: Date }).updatedAt ?? now,
          createdAt: now,
        });
      }
    }

    const newVersion = createHistory
      ? Math.floor(Number((currentDoc as { version?: number })?.version) || 0) + 1
      : Math.floor(Number((currentDoc as { version?: number })?.version) || 1);

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

    const historyCount = await db.collection(HIST).countDocuments({ fileName });
    if (historyCount > 20) {
      const oldestToDelete = await db
        .collection(HIST)
        .find({ fileName })
        .sort({ createdAt: 1 })
        .limit(historyCount - 20)
        .toArray();
      if (oldestToDelete.length > 0) {
        const { ObjectId } = await import('mongodb');
        const ids = oldestToDelete.map((d) => d._id as InstanceType<typeof ObjectId>);
        await db.collection(HIST).deleteMany({ _id: { $in: ids } });
      }
    }

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
