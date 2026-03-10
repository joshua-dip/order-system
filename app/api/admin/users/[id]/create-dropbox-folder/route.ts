import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { createUserDropboxFolder, isDropboxConfigured } from '@/lib/dropbox';

async function requireAdmin(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) {
    return { error: NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 }), payload: null };
  }
  const payload = await verifyToken(token);
  if (!payload || payload.role !== 'admin') {
    return { error: NextResponse.json({ error: '관리자만 이용할 수 있습니다.' }, { status: 403 }), payload: null };
  }
  return { error: null, payload };
}

/** 관리자: 해당 회원용 드롭박스 폴더 생성 후 경로를 회원 정보에 저장 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error } = await requireAdmin(request);
    if (error) return error;

    const { id } = await params;
    if (!id || !ObjectId.isValid(id)) {
      return NextResponse.json({ error: '유효하지 않은 ID입니다.' }, { status: 400 });
    }

    if (!isDropboxConfigured()) {
      return NextResponse.json(
        { error: 'Dropbox가 설정되어 있지 않습니다. 환경 변수를 확인해주세요.' },
        { status: 503 }
      );
    }

    const db = await getDb('gomijoshua');
    const user = await db.collection('users').findOne(
      { _id: new ObjectId(id), role: 'user' },
      { projection: { loginId: 1, name: 1, phone: 1 } }
    );
    if (!user) {
      return NextResponse.json({ error: '회원을 찾을 수 없습니다.' }, { status: 404 });
    }

    const loginId = (user.loginId as string) ?? '';
    const name = (user.name as string) ?? loginId;
    const phone = typeof user.phone === 'string' ? user.phone.trim() : undefined;
    const folderPath = await createUserDropboxFolder(loginId, name, phone || undefined);

    await db.collection('users').updateOne(
      { _id: new ObjectId(id) },
      { $set: { dropboxFolderPath: folderPath } }
    );

    return NextResponse.json({ ok: true, dropboxFolderPath: folderPath });
  } catch (err) {
    console.error('드롭박스 폴더 생성 실패:', err);
    const message = err instanceof Error ? err.message : '폴더 생성에 실패했습니다.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
