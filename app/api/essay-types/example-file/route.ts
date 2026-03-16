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
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/**
 * 서술형 유형 예시 파일 다운로드 (서술형 접근 권한 있는 사용자만)
 */
export async function GET(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const typeId = searchParams.get('typeId');
  if (!typeId || !ObjectId.isValid(typeId)) {
    return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 });
  }

  try {
    const db = await getDb('gomijoshua');
    const doc = await db.collection('essayTypes').findOne({ _id: new ObjectId(typeId) });
    if (!doc) return NextResponse.json({ error: '해당 유형을 찾을 수 없습니다.' }, { status: 404 });

    const isAdmin = payload.role === 'admin';
    if (!isAdmin) {
      if (doc.enabled === false) return NextResponse.json({ error: '해당 유형을 찾을 수 없습니다.' }, { status: 404 });
      const user = await db.collection('users').findOne(
        { _id: new ObjectId(payload.sub) },
        { projection: { canAccessEssay: 1, allowedEssayTypeIds: 1 } }
      );
      const canAccessEssay = !!user?.canAccessEssay;
      if (!canAccessEssay) return NextResponse.json({ error: '서술형 메뉴 이용 권한이 없습니다.' }, { status: 403 });
      const allowedSet = new Set(Array.isArray(user?.allowedEssayTypeIds) ? user.allowedEssayTypeIds : []);
      const isCommon = doc.common === true || doc.common === undefined;
      const isAllowed = isCommon || allowedSet.has(typeId);
      if (!isAllowed) return NextResponse.json({ error: '해당 유형 예시를 볼 수 있는 권한이 없습니다.' }, { status: 403 });
    }

    const exampleFile = doc.exampleFile;
    if (!exampleFile?.savedPath) {
      return NextResponse.json({ error: '예시 파일이 없습니다.' }, { status: 404 });
    }

    const filePath = path.join(process.cwd(), exampleFile.savedPath);
    try {
      await fs.access(filePath);
    } catch {
      return NextResponse.json({ error: '파일을 찾을 수 없습니다.' }, { status: 404 });
    }

    const fileBuffer = await fs.readFile(filePath);
    const ext = path.extname(exampleFile.originalName || exampleFile.savedPath).toLowerCase();
    const contentType = MIME_MAP[ext] || 'application/octet-stream';
    const encodedName = encodeURIComponent(exampleFile.originalName || `example${ext}`);

    return new NextResponse(new Uint8Array(fileBuffer), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodedName}`,
        'Content-Length': String(fileBuffer.length),
      },
    });
  } catch (err) {
    console.error('예시 파일 다운로드 실패:', err);
    return NextResponse.json({ error: '다운로드에 실패했습니다.' }, { status: 500 });
  }
}
