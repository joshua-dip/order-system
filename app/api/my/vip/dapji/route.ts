import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVipMenu } from '@/lib/vip-menu-guard';
import { getDb } from '@/lib/mongodb';
import path from 'path';
import {
  DAPJI_FILES_COLLECTION, DAPJI_MAX_SIZE, DAPJI_ALLOWED,
  putFile, delFile, type DapjiFileDoc,
} from '@/lib/vip-dapji-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function view(d: DapjiFileDoc) {
  return {
    id: String(d._id),
    title: d.title,
    level: d.level,
    note: d.note,
    filename: d.filename,
    contentType: d.contentType,
    size: d.size,
    copyrighted: !!d.copyrighted,
    createdAt: d.createdAt instanceof Date ? d.createdAt.toISOString() : null,
  };
}

/** GET — 내 답지 목록 (최신순) */
export async function GET(request: NextRequest) {
  const auth = await requireVipMenu(request, 'dapji');
  if (auth instanceof NextResponse) return auth;
  const db = await getDb('gomijoshua');
  const docs = await db.collection<DapjiFileDoc>(DAPJI_FILES_COLLECTION)
    .find({ userId: new ObjectId(auth.userId) }, { projection: { gridId: 0 } })
    .sort({ createdAt: -1 }).limit(500).toArray();
  const levels = [...new Set(docs.map((d) => d.level).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
  return NextResponse.json({ ok: true, items: docs.map(view), levels });
}

/** POST multipart { file, title?, level?, note?, copyrighted? } — 답지 업로드 */
export async function POST(request: NextRequest) {
  const auth = await requireVipMenu(request, 'dapji');
  if (auth instanceof NextResponse) return auth;
  try {
    const fd = await request.formData();
    const f = fd.get('file');
    if (!f || typeof f !== 'object' || !('arrayBuffer' in f)) {
      return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 });
    }
    const file = f as File;
    if (file.size > DAPJI_MAX_SIZE) return NextResponse.json({ error: '파일은 30MB 이하만 가능합니다.' }, { status: 400 });
    const ext = path.extname(file.name || '').toLowerCase();
    const contentType = DAPJI_ALLOWED[ext];
    if (!contentType) return NextResponse.json({ error: 'PDF·PNG·JPG·WEBP 만 가능합니다.' }, { status: 400 });

    const title = (String(fd.get('title') ?? '').trim() || file.name || '답지').slice(0, 120);
    const level = String(fd.get('level') ?? '').trim().slice(0, 40);
    const note = String(fd.get('note') ?? '').trim().slice(0, 300);
    const copyrighted = String(fd.get('copyrighted') ?? '') === 'true';

    const db = await getDb('gomijoshua');
    const buf = Buffer.from(await file.arrayBuffer());
    const gridId = await putFile(db, buf, file.name || 'dapji', contentType);
    const doc: DapjiFileDoc = {
      userId: new ObjectId(auth.userId),
      title, level, note,
      filename: (file.name || 'dapji').slice(0, 200),
      contentType, size: file.size, gridId, copyrighted,
      createdAt: new Date(),
    };
    const r = await db.collection(DAPJI_FILES_COLLECTION).insertOne(doc);
    return NextResponse.json({ ok: true, item: view({ ...doc, _id: r.insertedId }) }, { status: 201 });
  } catch (e) {
    console.error('dapji upload:', e);
    return NextResponse.json({ error: '업로드에 실패했습니다.' }, { status: 500 });
  }
}

/** DELETE ?id= — 답지 삭제 (메타 + GridFS) */
export async function DELETE(request: NextRequest) {
  const auth = await requireVipMenu(request, 'dapji');
  if (auth instanceof NextResponse) return auth;
  const id = request.nextUrl.searchParams.get('id');
  if (!id || !ObjectId.isValid(id)) return NextResponse.json({ error: 'id 가 필요합니다.' }, { status: 400 });
  const db = await getDb('gomijoshua');
  const userId = new ObjectId(auth.userId);
  const doc = await db.collection<DapjiFileDoc>(DAPJI_FILES_COLLECTION).findOne({ _id: new ObjectId(id), userId });
  if (!doc) return NextResponse.json({ error: '답지를 찾을 수 없습니다.' }, { status: 404 });
  await db.collection(DAPJI_FILES_COLLECTION).deleteOne({ _id: doc._id });
  await delFile(db, doc.gridId);
  return NextResponse.json({ ok: true });
}
