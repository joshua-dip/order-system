import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { ObjectId } from 'mongodb';
import path from 'path';
import fs from 'fs/promises';
import { toMongoExampleBinary } from '@/lib/essay-type-example-file';

const UPLOAD_DIR = 'uploads/essay-type-examples';
const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB

const ALLOWED_EXT = ['.pdf', '.hwp', '.hwpx', '.doc', '.docx', '.jpg', '.jpeg', '.png', '.gif', '.webp'];

async function requireAdmin(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return { error: NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 }), payload: null };
  const payload = await verifyToken(token);
  if (!payload || payload.role !== 'admin') {
    return { error: NextResponse.json({ error: '관리자만 이용할 수 있습니다.' }, { status: 403 }), payload: null };
  }
  return { error: null, payload };
}

/**
 * 예시 파일 업로드 (유형당 1개, 새 파일로 교체)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireAdmin(request);
  if (error) return error;
  const { id } = await params;
  if (!id || !ObjectId.isValid(id)) {
    return NextResponse.json({ error: '유효하지 않은 ID입니다.' }, { status: 400 });
  }
  try {
    const db = await getDb('gomijoshua');
    const exists = await db.collection('essayTypes').findOne(
      { _id: new ObjectId(id) },
      { projection: { _id: 1 } }
    );
    if (!exists) return NextResponse.json({ error: '해당 유형을 찾을 수 없습니다.' }, { status: 404 });

    const formData = await request.formData();
    const file = formData.get('file');
    if (!file || typeof file !== 'object' || !('arrayBuffer' in file)) {
      return NextResponse.json({ error: '파일을 선택해 주세요.' }, { status: 400 });
    }
    const f = file as File;
    if (f.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: '파일 크기는 15MB 이하여야 합니다.' }, { status: 400 });
    }
    const rawName = f.name || '';
    const ext = path.extname(rawName).toLowerCase();
    if (ext && !ALLOWED_EXT.includes(ext)) {
      return NextResponse.json({ error: `허용 확장자: ${ALLOWED_EXT.join(', ')}` }, { status: 400 });
    }
    // 표시용 파일명은 한글 등 그대로 유지 (파일 시스템에는 example.ext 만 사용)
    const originalName = (rawName.trim() || `example${ext}`).slice(0, 120);
    const buf = Buffer.from(await f.arrayBuffer());

    // MongoDB에 저장 — 배포(서버리스) 환경에서 로컬 uploads/ 가 없어도 다운로드 가능
    await db.collection('essayTypes').updateOne(
      { _id: new ObjectId(id) },
      { $set: { exampleFile: { originalName, data: toMongoExampleBinary(buf) } } }
    );

    // 과거 디스크 저장본 정리
    const legacyDir = path.join(process.cwd(), UPLOAD_DIR, id);
    try {
      await fs.rm(legacyDir, { recursive: true, force: true });
    } catch { /* 없으면 무시 */ }

    return NextResponse.json({ ok: true, originalName });
  } catch (err) {
    console.error('예시 파일 업로드 실패:', err);
    return NextResponse.json({ error: '업로드에 실패했습니다.' }, { status: 500 });
  }
}

/**
 * 예시 파일 삭제
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireAdmin(request);
  if (error) return error;
  const { id } = await params;
  if (!id || !ObjectId.isValid(id)) {
    return NextResponse.json({ error: '유효하지 않은 ID입니다.' }, { status: 400 });
  }
  try {
    const db = await getDb('gomijoshua');
    const doc = await db.collection('essayTypes').findOne(
      { _id: new ObjectId(id) },
      { projection: { 'exampleFile.savedPath': 1 } }
    );
    if (!doc) return NextResponse.json({ error: '해당 유형을 찾을 수 없습니다.' }, { status: 404 });

    const savedPath = (doc.exampleFile as { savedPath?: string } | undefined)?.savedPath;
    if (savedPath) {
      try {
        await fs.rm(path.join(process.cwd(), savedPath), { force: true });
      } catch { /* 없으면 무시 */ }
    }
    const legacyDir = path.join(process.cwd(), UPLOAD_DIR, id);
    try {
      await fs.rm(legacyDir, { recursive: true, force: true });
    } catch { /* 폴더 없으면 무시 */ }

    await db.collection('essayTypes').updateOne(
      { _id: new ObjectId(id) },
      { $unset: { exampleFile: 1 } }
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('예시 파일 삭제 실패:', err);
    return NextResponse.json({ error: '삭제에 실패했습니다.' }, { status: 500 });
  }
}
