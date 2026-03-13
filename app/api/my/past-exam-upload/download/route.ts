import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { ObjectId } from 'mongodb';
import path from 'path';
import fs from 'fs/promises';

const MIME_MAP: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.hwp': 'application/x-hwp',
  '.hwpx': 'application/x-hwpx',
};

export async function GET(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const fileIndex = parseInt(searchParams.get('fileIndex') || '', 10);
  const inline = searchParams.get('inline') === '1';

  if (!id || !ObjectId.isValid(id) || isNaN(fileIndex) || fileIndex < 0) {
    return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 });
  }

  try {
    const db = await getDb('gomijoshua');
    const doc = await db.collection('pastExamUploads').findOne({ _id: new ObjectId(id) });

    if (!doc) return NextResponse.json({ error: '해당 업로드를 찾을 수 없습니다.' }, { status: 404 });
    if (doc.loginId !== payload.loginId && payload.role !== 'admin') {
      return NextResponse.json({ error: '다운로드 권한이 없습니다.' }, { status: 403 });
    }

    const files = doc.files || [];
    if (fileIndex >= files.length) {
      return NextResponse.json({ error: '파일을 찾을 수 없습니다.' }, { status: 404 });
    }

    const fileInfo = files[fileIndex];
    const filePath = path.join(process.cwd(), fileInfo.savedPath);

    try {
      await fs.access(filePath);
    } catch {
      return NextResponse.json({ error: '서버에서 파일을 찾을 수 없습니다.' }, { status: 404 });
    }

    const fileBuffer = await fs.readFile(filePath);
    const ext = path.extname(fileInfo.originalName || fileInfo.savedPath).toLowerCase();
    const contentType = MIME_MAP[ext] || 'application/octet-stream';
    const encodedName = encodeURIComponent(fileInfo.originalName || `file${ext}`);

    const disposition = inline
      ? `inline; filename*=UTF-8''${encodedName}`
      : `attachment; filename*=UTF-8''${encodedName}`;

    return new NextResponse(new Uint8Array(fileBuffer), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': disposition,
        'Content-Length': String(fileBuffer.length),
      },
    });
  } catch (err) {
    console.error('파일 다운로드 실패:', err);
    return NextResponse.json({ error: '다운로드에 실패했습니다.' }, { status: 500 });
  }
}
