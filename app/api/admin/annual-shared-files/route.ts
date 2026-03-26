import { NextRequest, NextResponse } from 'next/server';
import { Binary } from 'mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/lib/mongodb';

const COLLECTION = 'annualSharedFiles';
const MAX_BYTES = 15 * 1024 * 1024;
const ALLOWED_EXT = new Set(['.hwp', '.hwpx', '.pdf']);

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}

let indexEnsured = false;

async function ensureIndexes() {
  if (indexEnsured) return;
  try {
    const db = await getDb('gomijoshua');
    await db.collection(COLLECTION).createIndex({ sortOrder: 1, uploadedAt: -1 });
    indexEnsured = true;
  } catch {
    /* ignore */
  }
}

/** 목록(파일 바이너리 제외) */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const db = await getDb('gomijoshua');
    const rows = await db
      .collection(COLLECTION)
      .find({})
      .project({
        title: 1,
        description: 1,
        originalName: 1,
        contentType: 1,
        size: 1,
        sortOrder: 1,
        uploadedAt: 1,
        uploadedByLoginId: 1,
      })
      .sort({ sortOrder: 1, uploadedAt: -1 })
      .toArray();

    const items = rows.map((d) => ({
      id: String(d._id),
      title: typeof d.title === 'string' ? d.title : '',
      description: typeof d.description === 'string' ? d.description : '',
      originalName: typeof d.originalName === 'string' ? d.originalName : '',
      contentType: typeof d.contentType === 'string' ? d.contentType : '',
      size: typeof d.size === 'number' ? d.size : 0,
      sortOrder: typeof d.sortOrder === 'number' ? d.sortOrder : 0,
      uploadedAt: d.uploadedAt instanceof Date ? d.uploadedAt.toISOString() : null,
      uploadedByLoginId: typeof d.uploadedByLoginId === 'string' ? d.uploadedByLoginId : '',
    }));

    return NextResponse.json({ items });
  } catch (e) {
    console.error('admin annual-shared-files GET:', e);
    return NextResponse.json({ error: '목록 조회 실패' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const { error, payload } = await requireAdmin(request);
  if (error) return error;

  try {
    const formData = await request.formData();
    const titleField = formData.get('title');
    const title = typeof titleField === 'string' ? titleField.trim() : '';
    const descField = formData.get('description');
    const description = typeof descField === 'string' ? descField.trim() : '';
    const file = formData.get('file');

    if (!title) {
      return NextResponse.json({ error: '자료 제목을 입력해 주세요.' }, { status: 400 });
    }
    if (!file || typeof file === 'string' || !('arrayBuffer' in file)) {
      return NextResponse.json({ error: 'hwp·hwpx·pdf 파일을 선택해 주세요.' }, { status: 400 });
    }

    const f = file as File;
    const originalName = f.name || 'file';
    const ext = extOf(originalName);
    if (!ALLOWED_EXT.has(ext)) {
      return NextResponse.json({ error: '허용 형식: .hwp, .hwpx, .pdf' }, { status: 400 });
    }

    const buf = Buffer.from(await f.arrayBuffer());
    if (buf.length === 0) {
      return NextResponse.json({ error: '빈 파일입니다.' }, { status: 400 });
    }
    if (buf.length > MAX_BYTES) {
      return NextResponse.json({ error: `파일은 ${MAX_BYTES / 1024 / 1024}MB 이하여야 합니다.` }, { status: 400 });
    }

    const contentType = f.type || (ext === '.pdf' ? 'application/pdf' : 'application/octet-stream');

    await ensureIndexes();
    const db = await getDb('gomijoshua');
    const maxSort = await db.collection(COLLECTION).findOne({}, { sort: { sortOrder: -1 }, projection: { sortOrder: 1 } });
    const maxDoc = maxSort as unknown as { sortOrder?: unknown } | null;
    const prevOrder = typeof maxDoc?.sortOrder === 'number' ? maxDoc.sortOrder : null;
    const nextOrder = prevOrder !== null ? prevOrder + 1 : 0;

    const now = new Date();
    const doc = {
      title,
      description: description || undefined,
      originalName,
      contentType,
      size: buf.length,
      file: new Binary(buf),
      sortOrder: nextOrder,
      uploadedAt: now,
      uploadedByLoginId: payload?.loginId ?? 'admin',
    };

    const r = await db.collection(COLLECTION).insertOne(doc);
    return NextResponse.json({ ok: true, id: String(r.insertedId) });
  } catch (e) {
    console.error('admin annual-shared-files POST:', e);
    return NextResponse.json({ error: '업로드에 실패했습니다.' }, { status: 500 });
  }
}
