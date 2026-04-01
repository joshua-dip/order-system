import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/lib/mongodb';

const ASSIGN = 'textbook_link_folder_assignments';

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const db = await getDb('gomijoshua');
    const items = await db.collection(ASSIGN).find({}).project({ textbookKey: 1, folderId: 1 }).toArray();
    const assignments: Record<string, string> = {};
    for (const it of items) {
      const k = typeof (it as { textbookKey?: string }).textbookKey === 'string'
        ? (it as { textbookKey: string }).textbookKey
        : '';
      const raw = (it as { folderId?: unknown }).folderId;
      const fid =
        raw == null ? '' : typeof raw === 'string' ? raw.trim().toLowerCase() : String(raw).trim().toLowerCase();
      if (k && fid) assignments[k] = fid;
    }
    return NextResponse.json({ success: true, assignments });
  } catch (e) {
    console.error('textbook-link-folder-assignments GET:', e);
    return NextResponse.json({ success: false, message: '조회 실패' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const body = await request.json();
    const textbookKey = typeof body?.textbookKey === 'string' ? body.textbookKey.trim() : '';
    const folderId = typeof body?.folderId === 'string' ? body.folderId.trim() : '';
    if (!textbookKey) {
      return NextResponse.json({ success: false, message: 'textbookKey가 필요합니다.' }, { status: 400 });
    }

    const db = await getDb('gomijoshua');
    const col = db.collection(ASSIGN);

    if (!folderId) {
      await col.deleteOne({ textbookKey });
      return NextResponse.json({ success: true });
    }

    await col.updateOne(
      { textbookKey },
      {
        $set: { textbookKey, folderId, updatedAt: new Date() },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true }
    );
    await col.createIndex({ textbookKey: 1 }, { unique: true }).catch(() => {});
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('textbook-link-folder-assignments POST:', e);
    return NextResponse.json({ success: false, message: '저장 실패' }, { status: 500 });
  }
}
