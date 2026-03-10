import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { notifySlackOrder } from '@/lib/slack';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { createOrderFolder, uploadOrderTxt, isDropboxConfigured } from '@/lib/dropbox';

const COLLECTION = 'orders';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const orderText = typeof body?.orderText === 'string' ? body.orderText.trim() : '';

    if (!orderText) {
      return NextResponse.json(
        { error: 'orderText가 필요합니다.' },
        { status: 400 }
      );
    }

    // 주문 접두어: 2글자 영문 (재료+제품). 미전달 또는 잘못된 값이면 'GJ' 사용
    const rawPrefix = typeof body?.orderPrefix === 'string' ? body.orderPrefix.trim().toUpperCase() : '';
    const orderPrefix = /^[A-Z]{2}$/.test(rawPrefix) ? rawPrefix : 'GJ';

    let loginId: string | null = null;
    let userName: string = '';
    const token = request.cookies.get(COOKIE_NAME)?.value;
    if (token) {
      const payload = await verifyToken(token);
      if (payload) loginId = payload.loginId;
    }

    const db = await getDb('gomijoshua');
    const collection = db.collection(COLLECTION);

    // 회원이면 이름·드롭박스 경로·전화번호 조회
    let userDropboxFolderPath: string | undefined;
    let userPhone: string | undefined;
    if (loginId) {
      const userDoc = await db.collection('users').findOne(
        { loginId },
        { projection: { name: 1, dropboxFolderPath: 1, phone: 1 } }
      );
      userName = (userDoc?.name as string) || loginId;
      const path = userDoc?.dropboxFolderPath;
      userDropboxFolderPath = typeof path === 'string' && path.trim() ? path.trim() : undefined;
      userPhone = typeof userDoc?.phone === 'string' && userDoc.phone.trim() ? userDoc.phone.trim() : undefined;
    }

    // 접두어-YYYYMMDD-NNN 형식 주문번호 생성 (접두어: 재료+제품 2글자, 예: MV, BV, MW)
    const now = new Date();
    const pad = (n: number, d = 2) => String(n).padStart(d, '0');
    const datePart = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const todayCount = await collection.countDocuments({
      createdAt: { $gte: dayStart, $lt: dayEnd },
    });
    const orderNumber = `${orderPrefix}-${datePart}-${pad(todayCount + 1, 3)}`;

    const doc = {
      orderText,
      createdAt: now,
      source: 'gomijoshua',
      status: 'pending',
      orderNumber,
      ...(loginId && { loginId }),
    };

    const result = await collection.insertOne(doc);
    const orderId = result.insertedId.toString();

    notifySlackOrder(orderText, orderId).catch((e) =>
      console.error('Slack 알림 실패:', e)
    );

    // 드롭박스: 회원 주문이고 환경 변수 설정된 경우에만 폴더 생성 + 주문서 txt 업로드
    if (loginId && isDropboxConfigured()) {
      createOrderFolder({
        loginId,
        name: userName,
        orderNumber,
        userDropboxFolderPath,
        phone: userPhone,
      })
        .then((folderPath) => {
          console.log('Dropbox 폴더 생성:', folderPath);
          return uploadOrderTxt(folderPath, orderNumber, orderText);
        })
        .then(() => console.log('Dropbox 주문서 업로드 완료'))
        .catch((e) => console.error('Dropbox 실패:', e));
    }

    return NextResponse.json({
      ok: true,
      id: orderId,
      orderNumber,
    });
  } catch (err) {
    console.error('주문 저장 실패:', err);
    const message = err instanceof Error ? err.message : '';
    const isEnvMissing = message.includes('MONGODB_URI');
    return NextResponse.json(
      {
        error: isEnvMissing
          ? 'MONGODB_URI를 .env.local에 설정한 뒤 서버를 다시 실행해주세요.'
          : '주문 저장 중 오류가 발생했습니다.',
      },
      { status: isEnvMissing ? 503 : 500 }
    );
  }
}
