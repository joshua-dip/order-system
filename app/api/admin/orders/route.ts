import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import {
  parseOrderRevenueFromOrderText,
  resolvePointOrderDisplayAmounts,
  getBookVariantSolbookAccounting,
} from '@/lib/order-revenue';

const STATUS_LABELS: Record<string, string> = {
  pending: '주문 접수',
  accepted: '제작 수락',
  payment_confirmed: '입금 확인',
  in_progress: '제작 중',
  completed: '완료',
  cancelled: '취소됨',
};

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get(COOKIE_NAME)?.value;
    if (!token) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }
    const payload = await verifyToken(token);
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: '관리자만 이용할 수 있습니다.' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const loginId = searchParams.get('loginId')?.trim() || undefined;
    const limitRaw = parseInt(searchParams.get('limit') || '', 10);
    const defaultLimit = loginId ? 50 : 30;
    const limit = Math.min(100, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : defaultLimit));

    const db = await getDb('gomijoshua');
    const filter = loginId ? { loginId } : {};
    const list = await db
      .collection('orders')
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    const orders = list.map((o) => {
      const meta =
        o.orderMeta && typeof o.orderMeta === 'object' && !Array.isArray(o.orderMeta)
          ? (o.orderMeta as Record<string, unknown>)
          : null;
      const rev = (o as { revenueWon?: unknown }).revenueWon;
      const completedAt = (o as { completedAt?: unknown }).completedAt;
      const rawPu = (o as { pointsUsed?: unknown }).pointsUsed;
      const pointsUsed =
        typeof rawPu === 'number' && Number.isFinite(rawPu) && rawPu > 0 ? Math.floor(rawPu) : 0;
      const orderTextStr = typeof o.orderText === 'string' ? o.orderText : '';
      const status = o.status || 'pending';
      const storedRev =
        typeof rev === 'number' && Number.isFinite(rev) && rev >= 0 ? Math.round(rev) : null;
      const solAcc = getBookVariantSolbookAccounting(meta ?? undefined);

      let revenueWon: number | null = null;
      let orderGrossWon: number | null = null;
      let paymentDueWon: number | null = null;
      const solbookAccountingSplit = status === 'completed' && !!solAcc;

      if (status === 'completed') {
        const parsedFull = parseOrderRevenueFromOrderText(orderTextStr, meta ?? undefined);
        if (solAcc) {
          revenueWon = solAcc.chargedCustomWon;
          if (parsedFull != null && parsedFull > 0) {
            orderGrossWon = parsedFull;
          } else if (storedRev != null && storedRev > solAcc.chargedCustomWon) {
            orderGrossWon = storedRev;
          }
        } else {
          revenueWon = storedRev ?? parsedFull;
          const pointDisp =
            pointsUsed > 0
              ? resolvePointOrderDisplayAmounts({
                  orderText: orderTextStr,
                  revenueWon,
                  pointsUsed,
                })
              : { grossWon: null as number | null, paymentDueWon: null as number | null };
          orderGrossWon = pointDisp.grossWon;
          paymentDueWon = pointsUsed > 0 ? pointDisp.paymentDueWon : null;
        }
      }

      return {
        id: o._id.toString(),
        orderText: o.orderText,
        createdAt: o.createdAt,
        status,
        statusLabel: STATUS_LABELS[status] || o.status || '주문 접수',
        loginId: o.loginId ?? null,
        orderNumber: o.orderNumber ?? null,
        fileUrl: o.fileUrl ?? null,
        dropboxFolderCreated: !!(o as { dropboxFolderCreated?: boolean }).dropboxFolderCreated,
        hasOrderMeta: !!meta,
        orderMetaFlow: meta && typeof meta.flow === 'string' ? meta.flow : null,
        revenueWon,
        pointsUsed,
        /** 쏠북 BV: 변형 제작 포함 주문 합계. 포인트 주문: 기존 추정 총액 */
        orderGrossWon,
        /** 포인트 사용 시 실제 입금할 금액(추정). 쏠북 BV 분리 시에는 미사용 */
        paymentDueWon,
        /** 완료·쏠북 연계 BV: 매출(revenueWon)은 커스텀만, 합계는 orderGrossWon */
        solbookAccountingSplit,
        completedAt:
          completedAt instanceof Date
            ? completedAt.toISOString()
            : typeof completedAt === 'string'
              ? completedAt
              : null,
      };
    });

    return NextResponse.json({ orders });
  } catch (err) {
    console.error('관리자 주문 목록 조회 실패:', err);
    return NextResponse.json(
      { error: '목록 조회 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
