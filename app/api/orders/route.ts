import { NextRequest, NextResponse } from 'next/server';
import type { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { notifySlackOrder } from '@/lib/slack';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { createOrderFolder, uploadOrderTxt, isDropboxConfigured } from '@/lib/dropbox';
import { ORDER_FOOTER_MESSAGE } from '@/lib/orders';
import { recordPointLedger } from '@/lib/point-ledger';
import { extractOrderItemKeys, describeOverlapKey } from '@/lib/order-overlap';

const COLLECTION = 'orders';

type OrderNumberCounterDoc = { _id: string; n: number };

/** 회원 주문 시 주문서에 안내할 입금 계좌 */
const MEMBER_DEPOSIT_ACCOUNT = '110493861106 신한은행 박준규(페이퍼릭)';

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

    const pointsUsed = typeof body?.pointsUsed === 'number' && body.pointsUsed >= 0 ? Math.floor(body.pointsUsed) : 0;

    let loginId: string | null = null;
    let userName: string = '';
    const token = request.cookies.get(COOKIE_NAME)?.value;
    if (token) {
      const payload = await verifyToken(token);
      if (payload) loginId = payload.loginId;
    }

    const db = await getDb('gomijoshua');
    const collection = db.collection(COLLECTION);
    const usersColl = db.collection('users');

    // ── 중복 주문 경고 (채번·포인트 차감 이전) ─────────────────────────────
    // 같은 고객(회원 또는 동일 이메일)의 최근 변형 주문과 (지문×유형)이 겹치면,
    // confirmDuplicate 플래그가 없을 때 409 로 안내해 고객이 확인 후 진행하게 한다.
    // 같은 지문·유형도 새 문제로 재배정되므로 '차단'이 아니라 '확인' 용도.
    const confirmDuplicate = body?.confirmDuplicate === true;
    if (!confirmDuplicate) {
      const rawMetaForCheck =
        body?.orderMeta && typeof body.orderMeta === 'object' && !Array.isArray(body.orderMeta)
          ? (body.orderMeta as Record<string, unknown>)
          : null;
      const newKeys = rawMetaForCheck ? extractOrderItemKeys(rawMetaForCheck) : new Set<string>();
      if (newKeys.size > 0) {
        const emailRaw = typeof rawMetaForCheck?.email === 'string' ? rawMetaForCheck.email.trim() : '';
        const or: Record<string, unknown>[] = [];
        if (loginId) or.push({ loginId });
        if (emailRaw) or.push({ 'orderMeta.email': emailRaw });
        if (or.length > 0) {
          const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
          const prior = await collection
            .find({ $or: or, status: { $ne: 'cancelled' }, createdAt: { $gte: since } })
            .sort({ createdAt: -1 })
            .limit(50)
            .toArray();
          // 같은 고객의 기존 주문 전체에서 (지문×유형) 합집합을 만들고,
          // 새 주문의 모든 항목이 그 안에 이미 있으면(=신규 0건) "완전 중복"으로 본다.
          const priorUnion = new Set<string>();
          let bestCount = 0;
          let bestOrder: Record<string, unknown> | null = null;
          for (const p of prior) {
            const pk = extractOrderItemKeys((p as { orderMeta?: unknown }).orderMeta as Record<string, unknown>);
            let c = 0;
            for (const k of newKeys) if (pk.has(k)) c += 1;
            for (const k of pk) priorUnion.add(k);
            if (c > bestCount) { bestCount = c; bestOrder = p; }
          }
          let newItemCount = 0;
          for (const k of newKeys) if (!priorUnion.has(k)) newItemCount += 1;
          // 완전 중복(신규 0건)일 때만 경고. 새로 추가되는 항목이 하나라도 있으면 통과.
          if (newItemCount === 0 && bestOrder) {
            return NextResponse.json(
              {
                duplicate: true,
                complete: true,
                sharedCount: newKeys.size,
                existingOrderNumber: (bestOrder as { orderNumber?: string }).orderNumber ?? null,
                sharedSamples: [...newKeys].slice(0, 5).map(describeOverlapKey),
              },
              { status: 409 },
            );
          }
        }
      }
    }

    // 회원이면 이름·드롭박스 경로·전화번호·포인트 조회
    let userDropboxFolderPath: string | undefined;
    let userPhone: string | undefined;
    /** 포인트 차감 후 주문 성공 시 원장 기록용 */
    let pointSpendLedger: { userId: ObjectId; balanceAfter: number; amount: number } | undefined;
    if (loginId) {
      const userDoc = await usersColl.findOne(
        { loginId },
        { projection: { name: 1, dropboxFolderPath: 1, phone: 1, points: 1, _id: 1 } }
      );
      userName = (userDoc?.name as string) || loginId;
      const path = userDoc?.dropboxFolderPath;
      userDropboxFolderPath = typeof path === 'string' && path.trim() ? path.trim() : undefined;
      userPhone = typeof userDoc?.phone === 'string' && userDoc.phone.trim() ? userDoc.phone.trim() : undefined;

      // 포인트 사용 시 차감
      if (pointsUsed > 0 && userDoc) {
        const docPoints = (userDoc as { points?: number }).points;
        const currentPoints = typeof docPoints === 'number' && docPoints >= 0 ? docPoints : 0;
        if (currentPoints < pointsUsed) {
          return NextResponse.json(
            { error: `보유 포인트(${currentPoints}P)가 부족합니다. 사용 요청: ${pointsUsed}P` },
            { status: 400 }
          );
        }
        await usersColl.updateOne(
          { _id: userDoc._id },
          { $inc: { points: -pointsUsed } }
        );
        pointSpendLedger = {
          userId: userDoc._id as ObjectId,
          balanceAfter: currentPoints - pointsUsed,
          amount: pointsUsed,
        };
      }
    }

    // 접두어-YYYYMMDD-NNN 형식 주문번호 — 일별 카운터를 원자적으로 올려 동시 요청 시 번호 충돌 방지
    const now = new Date();
    const pad = (n: number, d = 2) => String(n).padStart(d, '0');
    const datePart = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const counterColl = db.collection<OrderNumberCounterDoc>('orderNumberCounters');
    const counterKey = `${orderPrefix}_${datePart}`;

    let orderNumber = '';
    for (let attempt = 0; attempt < 200; attempt++) {
      const updated = await counterColl.findOneAndUpdate(
        { _id: counterKey },
        { $inc: { n: 1 } },
        { upsert: true, returnDocument: 'after' }
      );
      const n = updated && typeof updated.n === 'number' ? updated.n : attempt + 1;
      const candidate = `${orderPrefix}-${datePart}-${pad(n, 3)}`;
      const clash = await collection.findOne({ orderNumber: candidate }, { projection: { _id: 1 } });
      if (!clash) {
        orderNumber = candidate;
        break;
      }
      if (attempt === 199) {
        return NextResponse.json(
          { error: '주문번호를 할당하지 못했습니다. 잠시 후 다시 시도해 주세요.' },
          { status: 503 }
        );
      }
    }

    if (!orderNumber) {
      return NextResponse.json(
        { error: '주문번호를 할당하지 못했습니다. 잠시 후 다시 시도해 주세요.' },
        { status: 503 }
      );
    }

    // 회원 주문 시 주문서 끝에 입금 계좌 안내 추가 (이미 포함되어 있으면 제외)
    let finalOrderText = orderText;
    if (loginId && !orderText.includes('입금 계좌') && !orderText.includes(MEMBER_DEPOSIT_ACCOUNT)) {
      finalOrderText = `${orderText.trim()}

[회원 입금 계좌]
${MEMBER_DEPOSIT_ACCOUNT}`;
    }
    // 고객용 안내 문구 (회원/비회원 공통, 이미 포함돼 있으면 제외)
    const footer = (ORDER_FOOTER_MESSAGE || '').trim();
    if (footer && !finalOrderText.includes(footer.slice(0, 30))) {
      finalOrderText = `${finalOrderText.trim()}\n\n${footer}`;
    }

    // 구조화 메타(지문·유형 등): 회원/비회원 모두 저장 — 관리자 문제수 검증·재주문 옵션 등에 사용
    let orderMeta: Record<string, unknown> | undefined;
    const rawMeta = body?.orderMeta;
    if (rawMeta != null && typeof rawMeta === 'object' && !Array.isArray(rawMeta)) {
      try {
        const s = JSON.stringify(rawMeta);
        if (s.length <= 48_000) orderMeta = rawMeta as Record<string, unknown>;
      } catch {
        /* ignore */
      }
    }

    const doc = {
      orderText: finalOrderText,
      createdAt: now,
      source: 'gomijoshua',
      status: 'pending',
      orderNumber,
      ...(loginId && { loginId }),
      ...(pointsUsed > 0 && { pointsUsed }),
      ...(orderMeta && { orderMeta }),
    };

    const result = await collection.insertOne(doc);
    const orderId = result.insertedId.toString();

    if (pointSpendLedger) {
      await recordPointLedger(db, {
        userId: pointSpendLedger.userId,
        delta: -pointSpendLedger.amount,
        balanceAfter: pointSpendLedger.balanceAfter,
        kind: 'order_spend',
        meta: { orderNumber, orderId },
      }).catch((e) => console.error('point_ledger 기록 실패:', e));
    }

    const orderFlow =
      orderMeta && typeof orderMeta.flow === 'string' ? (orderMeta.flow as string) : undefined;
    notifySlackOrder({
      orderText: finalOrderText,
      orderId,
      orderNumber,
      flow: orderFlow,
      loginId,
      userName: loginId ? userName : undefined,
      pointsUsed: pointsUsed > 0 ? pointsUsed : undefined,
    }).catch((e) => console.error('Slack 알림 실패:', e));

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
          return uploadOrderTxt(folderPath, orderNumber, finalOrderText);
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
