import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { ObjectId } from 'mongodb';
import path from 'path';
import fs from 'fs/promises';

const EXAM_TYPES = ['1학기중간고사', '1학기기말고사', '2학기중간고사', '2학기기말고사'] as const;
const UPLOAD_DIR = 'uploads/past-exam';
const MAX_FILE_SIZE = 15 * 1024 * 1024;
const MAX_FILES = 5;

function safeFileName(original: string, index: number): string {
  const ext = path.extname(original) || '';
  const base = path.basename(original, ext).replace(/[^a-zA-Z0-9가-힣._-]/g, '_').slice(0, 80);
  return `${index}_${base}${ext}`;
}

export async function GET(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  try {
    const db = await getDb('gomijoshua');
    const docs = await db
      .collection('pastExamUploads')
      .find({ loginId: payload.loginId })
      .sort({ createdAt: -1 })
      .toArray();

    const items = docs.map((d) => ({
      id: d._id.toString(),
      school: d.school,
      grade: d.grade,
      examYear: d.examYear,
      examType: d.examType,
      examScope: d.examScope,
      files: (d.files || []).map((f: { originalName: string; savedPath: string }, idx: number) => ({
        originalName: f.originalName,
        fileIndex: idx,
      })),
      adminCategories: d.adminCategories || [],
      createdAt: d.createdAt,
    }));

    return NextResponse.json({ uploads: items });
  } catch (err) {
    console.error('기출문제 조회 실패:', err);
    return NextResponse.json({ error: '조회에 실패했습니다.' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  try {
    const { id } = await request.json();
    if (!id || !ObjectId.isValid(id)) {
      return NextResponse.json({ error: '유효하지 않은 ID입니다.' }, { status: 400 });
    }

    const db = await getDb('gomijoshua');
    const doc = await db.collection('pastExamUploads').findOne({ _id: new ObjectId(id) });
    if (!doc) return NextResponse.json({ error: '해당 업로드를 찾을 수 없습니다.' }, { status: 404 });
    if (doc.loginId !== payload.loginId) {
      return NextResponse.json({ error: '삭제 권한이 없습니다.' }, { status: 403 });
    }

    const dirPath = path.join(process.cwd(), UPLOAD_DIR, id);
    try {
      await fs.rm(dirPath, { recursive: true, force: true });
    } catch { /* 폴더가 없어도 무시 */ }

    await db.collection('pastExamUploads').deleteOne({ _id: new ObjectId(id) });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('기출문제 삭제 실패:', err);
    return NextResponse.json({ error: '삭제에 실패했습니다.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }
  const payload = await verifyToken(token);
  if (!payload) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const school = (formData.get('school') as string)?.trim() ?? '';
    const grade = (formData.get('grade') as string)?.trim() ?? '';
    const examYear = (formData.get('examYear') as string)?.trim() ?? '';
    const examType = (formData.get('examType') as string)?.trim() ?? '';
    const examScope = (formData.get('examScope') as string)?.trim() ?? '';

    if (!school) {
      return NextResponse.json({ error: '학교를 입력해주세요.' }, { status: 400 });
    }
    if (!grade) {
      return NextResponse.json({ error: '학년을 선택해주세요.' }, { status: 400 });
    }
    if (!examYear) {
      return NextResponse.json({ error: '시험연도를 선택해주세요.' }, { status: 400 });
    }
    if (!EXAM_TYPES.includes(examType as (typeof EXAM_TYPES)[number])) {
      return NextResponse.json({ error: '시험 종류를 선택해주세요.' }, { status: 400 });
    }

    const fileList: File[] = [];
    const filesField = formData.getAll('files');
    for (const f of filesField) {
      if (f && typeof f === 'object' && 'arrayBuffer' in f) fileList.push(f as File);
    }
    if (fileList.length > MAX_FILES) {
      return NextResponse.json({ error: `파일은 최대 ${MAX_FILES}개까지 첨부할 수 있습니다.` }, { status: 400 });
    }
    for (const f of fileList) {
      if (f.size > MAX_FILE_SIZE) {
        return NextResponse.json({ error: `파일 크기는 각 15MB 이하여야 합니다. (${f.name})` }, { status: 400 });
      }
    }

    const db = await getDb('gomijoshua');
    const doc = {
      loginId: payload.loginId,
      reason: '서술형 맞춤 제작에 사용',
      school,
      grade,
      examYear,
      examType,
      examScope,
      files: [] as { originalName: string; savedPath: string }[],
      createdAt: new Date(),
    };

    const result = await db.collection('pastExamUploads').insertOne(doc);
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

    if (doc.files.length > 0) {
      await db.collection('pastExamUploads').updateOne(
        { _id: result.insertedId },
        { $set: { files: doc.files } }
      );
    }

    return NextResponse.json({ ok: true, id: uploadId });
  } catch (err) {
    console.error('기출문제 업로드 저장 실패:', err);
    return NextResponse.json(
      { error: '저장 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
