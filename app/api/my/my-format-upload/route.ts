import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { ObjectId } from 'mongodb';
import path from 'path';
import fs from 'fs/promises';

const UPLOAD_DIR = 'uploads/my-format';
const ALLOWED_EXT = ['.hwp', '.hwpx'];
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_FILES = 10;

const TYPES = ['강의용자료', '수업용자료', '변형문제'] as const;
type FormatType = (typeof TYPES)[number];

function safeFileName(original: string, index: number): string {
  const ext = path.extname(original).toLowerCase();
  const base = path.basename(original, ext).replace(/[^a-zA-Z0-9가-힣._-]/g, '_').slice(0, 80);
  return `${index}_${base}${ext}`;
}

function isAllowedFile(name: string): boolean {
  const ext = path.extname(name).toLowerCase();
  return ALLOWED_EXT.includes(ext);
}

export async function GET(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  try {
    const db = await getDb('gomijoshua');
    const docs = await db
      .collection('myFormatUploads')
      .find({ loginId: payload.loginId })
      .sort({ createdAt: -1 })
      .toArray();

    const byType: Record<FormatType, { id: string; files: { originalName: string; fileIndex: number }[]; createdAt: string }[]> = {
      강의용자료: [],
      수업용자료: [],
      변형문제: [],
    };
    for (const d of docs) {
      const type = (TYPES as readonly string[]).includes(d.type) ? (d.type as FormatType) : '강의용자료';
      byType[type].push({
        id: d._id.toString(),
        files: (d.files || []).map((f: { originalName: string }, idx: number) => ({
          originalName: f.originalName,
          fileIndex: idx,
        })),
        createdAt: d.createdAt,
      });
    }
    return NextResponse.json({ byType });
  } catch (err) {
    console.error('나의양식 조회 실패:', err);
    return NextResponse.json({ error: '조회에 실패했습니다.' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  try {
    const body = await request.json().catch(() => ({}));
    const id = body.id;
    if (!id || !ObjectId.isValid(id)) {
      return NextResponse.json({ error: '유효하지 않은 ID입니다.' }, { status: 400 });
    }

    const db = await getDb('gomijoshua');
    const doc = await db.collection('myFormatUploads').findOne({ _id: new ObjectId(id) });
    if (!doc) return NextResponse.json({ error: '해당 업로드를 찾을 수 없습니다.' }, { status: 404 });
    if (doc.loginId !== payload.loginId) {
      return NextResponse.json({ error: '삭제 권한이 없습니다.' }, { status: 403 });
    }

    const dirPath = path.join(process.cwd(), UPLOAD_DIR, id);
    try {
      await fs.rm(dirPath, { recursive: true, force: true });
    } catch { /* ignore */ }

    await db.collection('myFormatUploads').deleteOne({ _id: new ObjectId(id) });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('나의양식 삭제 실패:', err);
    return NextResponse.json({ error: '삭제에 실패했습니다.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  try {
    const db = await getDb('gomijoshua');
    const userDoc = await db.collection('users').findOne(
      { _id: new ObjectId(payload.sub) },
      { projection: { myFormatApproved: 1 } }
    );
    if (!userDoc || !(userDoc as { myFormatApproved?: boolean }).myFormatApproved) {
      return NextResponse.json(
        { error: '나의양식 업로드는 관리자 승인 후 이용할 수 있습니다. 카카오톡으로 문의해 주세요.' },
        { status: 403 }
      );
    }

    const formData = await request.formData();
    const type = (formData.get('type') as string)?.trim();
    if (!type || !TYPES.includes(type as FormatType)) {
      return NextResponse.json({ error: '유형을 선택해주세요. (강의용자료 / 수업용자료 / 변형문제)' }, { status: 400 });
    }

    const fileList: File[] = [];
    const filesField = formData.getAll('files');
    for (const f of filesField) {
      if (f && typeof f === 'object' && 'arrayBuffer' in f) fileList.push(f as File);
    }
    if (fileList.length === 0) {
      return NextResponse.json({ error: 'hwp 또는 hwpx 파일을 선택해주세요.' }, { status: 400 });
    }
    if (fileList.length > MAX_FILES) {
      return NextResponse.json({ error: `파일은 최대 ${MAX_FILES}개까지 첨부할 수 있습니다.` }, { status: 400 });
    }
    for (const f of fileList) {
      if (!isAllowedFile(f.name)) {
        return NextResponse.json({ error: 'hwp, hwpx 파일만 업로드 가능합니다.' }, { status: 400 });
      }
      if (f.size > MAX_FILE_SIZE) {
        return NextResponse.json({ error: `파일 크기는 각 20MB 이하여야 합니다. (${f.name})` }, { status: 400 });
      }
    }

    const doc = {
      loginId: payload.loginId,
      type,
      files: [] as { originalName: string; savedPath: string }[],
      createdAt: new Date(),
    };

    const result = await db.collection('myFormatUploads').insertOne(doc);
    const uploadId = result.insertedId.toString();

    const rootDir = path.join(process.cwd(), UPLOAD_DIR, uploadId);
    await fs.mkdir(rootDir, { recursive: true });

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const savedName = safeFileName(file.name || 'file', i);
      const savedPath = path.join(rootDir, savedName);
      const buf = Buffer.from(await file.arrayBuffer());
      await fs.writeFile(savedPath, buf);
      doc.files.push({
        originalName: file.name || savedName,
        savedPath: path.join(UPLOAD_DIR, uploadId, savedName),
      });
    }

    await db.collection('myFormatUploads').updateOne(
      { _id: result.insertedId },
      { $set: { files: doc.files } }
    );

    return NextResponse.json({ ok: true, id: uploadId });
  } catch (err) {
    console.error('나의양식 업로드 실패:', err);
    return NextResponse.json({ error: '저장 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
