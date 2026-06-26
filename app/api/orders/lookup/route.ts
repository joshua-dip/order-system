import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { normalizeOrderScope } from '@/lib/order-scope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 주문번호 → 파이널 예비 모의고사 시험 범위(scope) 복원.
 * 정규화는 lib/order-scope (UV·MV·BV). 접근: admin 은 모든 주문, 일반 회원은 본인(loginId) 주문만.
 */
export async function GET(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const payload = token ? await verifyToken(token) : null;
  if (!payload?.loginId) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const n = (request.nextUrl.searchParams.get('n') || '').trim();
  if (!n) return NextResponse.json({ error: '주문번호를 입력해주세요.' }, { status: 400 });
  // 접두 2글자-날짜-일련번호 형태만 허용 (UV-/MV-/BV-…)
  if (!/^[A-Za-z]{2}-\d{8}-\d+$/.test(n)) {
    return NextResponse.json({ error: '주문번호 형식이 올바르지 않습니다. (예: UV-20260401-003)' }, { status: 400 });
  }

  try {
    const db = await getDb('gomijoshua');
    const order = await db
      .collection('orders')
      .findOne({ orderNumber: n }, { projection: { orderMeta: 1, loginId: 1, orderNumber: 1 } });
    if (!order) return NextResponse.json({ error: '해당 주문번호를 찾을 수 없습니다.' }, { status: 404 });

    // 시험 범위(교재·지문번호·유형)는 민감정보가 아니므로, 로그인한 사용자는 본인 주문이 아니어도 불러올 수 있다.
    // (개인정보·금액 등은 응답에 포함하지 않음 — orderMeta 의 scope 만 정규화해 반환)

    const meta = (order.orderMeta && typeof order.orderMeta === 'object' && !Array.isArray(order.orderMeta))
      ? (order.orderMeta as Record<string, unknown>)
      : {};
    const { scope, flow } = normalizeOrderScope(meta);
    if (!scope) {
      return NextResponse.json({
        error: `이 주문(${flow || '알 수 없는 형식'})에서는 시험 범위를 복원할 수 없습니다. 파이널(UV)·모의변형(MV)·부교재변형(BV) 주문만 지원합니다.`,
        flow,
      }, { status: 422 });
    }

    return NextResponse.json({ ok: true, orderNumber: n, flow, scope });
  } catch (e) {
    console.error('[orders/lookup]', e);
    return NextResponse.json({ error: '조회에 실패했습니다.' }, { status: 500 });
  }
}
