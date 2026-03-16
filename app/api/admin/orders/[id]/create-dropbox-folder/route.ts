import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import {
  createOrderFolder,
  createOrderFolderForGuest,
  uploadOrderTxt,
  isDropboxConfigured,
} from '@/lib/dropbox';

const ORDERS_COLLECTION = 'orders';

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

/** 관리자: 주문 번호 기준으로 Dropbox 주문 폴더 생성 후 주문서 txt 업로드 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error } = await requireAdmin(request);
    if (error) return error;

    const { id } = await params;
    if (!id || !ObjectId.isValid(id)) {
      return NextResponse.json({ error: '유효하지 않은 주문 ID입니다.' }, { status: 400 });
    }

    if (!isDropboxConfigured()) {
      return NextResponse.json(
        { error: 'Dropbox가 설정되어 있지 않습니다. 환경 변수를 확인해주세요.' },
        { status: 503 }
      );
    }

    const db = await getDb('gomijoshua');
    const order = await db.collection(ORDERS_COLLECTION).findOne(
      { _id: new ObjectId(id) },
      { projection: { orderNumber: 1, orderText: 1, loginId: 1 } }
    );
    if (!order) {
      return NextResponse.json({ error: '주문을 찾을 수 없습니다.' }, { status: 404 });
    }

    const orderNumber = (order.orderNumber as string)?.trim();
    const orderText = (order.orderText as string)?.trim() ?? '';
    if (!orderNumber) {
      return NextResponse.json({ error: '주문번호가 없습니다.' }, { status: 400 });
    }

    let folderPath: string;
    const loginId = (order.loginId as string)?.trim();

    if (loginId) {
      const user = await db.collection('users').findOne(
        { loginId },
        { projection: { name: 1, dropboxFolderPath: 1, phone: 1 } }
      );
      const name = (user?.name as string)?.trim() || loginId;
      const userDropboxFolderPath = (user?.dropboxFolderPath as string)?.trim() || undefined;
      const phone = typeof user?.phone === 'string' && user.phone.trim() ? user.phone.trim() : undefined;
      folderPath = await createOrderFolder({
        loginId,
        name,
        orderNumber,
        userDropboxFolderPath,
        phone,
      });
    } else {
      folderPath = await createOrderFolderForGuest(orderNumber);
    }

    await uploadOrderTxt(folderPath, orderNumber, orderText || '(내용 없음)');

    await db.collection(ORDERS_COLLECTION).updateOne(
      { _id: new ObjectId(id) },
      { $set: { dropboxFolderCreated: true } }
    );

    return NextResponse.json({ ok: true, folderPath });
  } catch (err) {
    console.error('주문 Dropbox 폴더 생성 실패:', err);
    const message = err instanceof Error ? err.message : '폴더 생성에 실패했습니다.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
