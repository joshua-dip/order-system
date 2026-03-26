import { NextRequest, NextResponse } from 'next/server';
import { ObjectId, Binary } from 'mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { isAnnualMemberActive } from '@/lib/annual-member';

const COLLECTION = 'annualSharedFiles';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const { id } = await params;
  if (!id || !ObjectId.isValid(id)) {
    return NextResponse.json({ error: '유효하지 않은 ID입니다.' }, { status: 400 });
  }

  try {
    const db = await getDb('gomijoshua');
    const user = await db.collection('users').findOne(
      { _id: new ObjectId(payload.sub) },
      { projection: { annualMemberSince: 1 } }
    );
    const since = (user as { annualMemberSince?: Date } | null)?.annualMemberSince;
    if (!isAnnualMemberActive(since ?? null)) {
      return NextResponse.json({ error: '연회원 전용입니다.' }, { status: 403 });
    }

    const doc = await db.collection(COLLECTION).findOne({ _id: new ObjectId(id) });
    if (!doc) return NextResponse.json({ error: '파일을 찾을 수 없습니다.' }, { status: 404 });

    const raw = doc.file as Binary | Buffer | Uint8Array | undefined;
    if (!raw) return NextResponse.json({ error: '파일 데이터가 없습니다.' }, { status: 404 });

    const buffer = Buffer.isBuffer(raw)
      ? raw
      : raw instanceof Binary
        ? Buffer.from(raw.buffer)
        : Buffer.from(raw);
    const originalName = typeof doc.originalName === 'string' ? doc.originalName : 'download';
    const contentType =
      typeof doc.contentType === 'string' && doc.contentType ? doc.contentType : 'application/octet-stream';

    const asciiName = originalName.replace(/[^\x20-\x7E가-힣._-]/g, '_');
    const utf8Name = encodeURIComponent(originalName);

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(buffer.length),
        'Content-Disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${utf8Name}`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (e) {
    console.error('annual-shared-files download:', e);
    return NextResponse.json({ error: '다운로드에 실패했습니다.' }, { status: 500 });
  }
}
