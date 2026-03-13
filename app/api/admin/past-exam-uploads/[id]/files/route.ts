import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { ObjectId } from 'mongodb';
import path from 'path';
import fs from 'fs/promises';

const UPLOAD_DIR = 'uploads/past-exam';
const MAX_FILE_SIZE = 15 * 1024 * 1024;
const MAX_FILES_TOTAL = 10;

function safeFileName(original: string, index: number): string {
  const ext = path.extname(original) || '';
  const base = path.basename(original, ext).replace(/[^a-zA-Z0-9가-힣._-]/g, '_').slice(0, 80);
  return `${index}_${base}${ext}`;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload || payload.role !== 'admin') {
    return NextResponse.json({ error: '관리자 권한이 필요합니다.' }, { status: 403 });
  }

  const { id } = await params;
  if (!id || !ObjectId.isValid(id)) {
    return NextResponse.json({ error: '유효하지 않은 ID입니다.' }, { status: 400 });
  }

  try {
    const db = await getDb('gomijoshua');
    const doc = await db.collection('pastExamUploads').findOne({ _id: new ObjectId(id) });
    if (!doc) return NextResponse.json({ error: '해당 업로드를 찾을 수 없습니다.' }, { status: 404 });

    const existingFiles = doc.files || [];
    if (existingFiles.length >= MAX_FILES_TOTAL) {
      return NextResponse.json({ error: `한 건당 최대 ${MAX_FILES_TOTAL}개까지 첨부 가능합니다.` }, { status: 400 });
    }

    const formData = await request.formData();
    const fileList: File[] = [];
    const filesField = formData.getAll('files');
    for (const f of filesField) {
      if (f && typeof f === 'object' && 'arrayBuffer' in f) fileList.push(f as File);
    }
    if (fileList.length === 0) {
      return NextResponse.json({ error: '첨부할 파일을 선택해주세요.' }, { status: 400 });
    }
    if (existingFiles.length + fileList.length > MAX_FILES_TOTAL) {
      return NextResponse.json({ error: `전체 ${MAX_FILES_TOTAL}개를 초과할 수 없습니다. (현재 ${existingFiles.length}개 + 추가 ${fileList.length}개)` }, { status: 400 });
    }
    for (const f of fileList) {
      if (f.size > MAX_FILE_SIZE) {
        return NextResponse.json({ error: `파일 크기는 각 15MB 이하여야 합니다. (${f.name})` }, { status: 400 });
      }
    }

    const rootDir = path.join(process.cwd(), UPLOAD_DIR, id);
    await fs.mkdir(rootDir, { recursive: true });

    const newEntries: { originalName: string; savedPath: string }[] = [];
    const startIndex = existingFiles.length;
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const savedName = safeFileName(file.name || 'file', startIndex + i);
      const savedPath = path.join(rootDir, savedName);
      const buf = Buffer.from(await file.arrayBuffer());
      await fs.writeFile(savedPath, buf);
      newEntries.push({
        originalName: file.name || savedName,
        savedPath: path.join(UPLOAD_DIR, id, savedName),
      });
    }

    await db.collection('pastExamUploads').updateOne(
      { _id: new ObjectId(id) },
      { $push: { files: { $each: newEntries } } } as Record<string, unknown>
    );

    return NextResponse.json({ ok: true, added: newEntries.length });
  } catch (err) {
    console.error('관리자 파일 추가 실패:', err);
    return NextResponse.json({ error: '파일 추가에 실패했습니다.' }, { status: 500 });
  }
}
