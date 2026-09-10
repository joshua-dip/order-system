import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { isPremiumMember, isMonthlyMemberActive } from '@/lib/premium-member';
import { isAnnualMemberActive } from '@/lib/annual-member';
import { baseFreeQuotaFor, kstMonthRange, paidBaseCountOfOrder } from '@/lib/variant-member-quota';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 이번 달 기본난도 무료 한도 잔량.
 *
 * 사용량은 별도 장부를 두지 않고 이번 달 변형문제 주문(BV/MV/UV)의 orderMeta 에서
 * 되센다 — 장부를 따로 두면 주문 취소·수정 때 실제와 어긋난다.
 */

export async function GET(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const payload = token ? await verifyToken(token).catch(() => null) : null;
  if (!payload) {
    return NextResponse.json({ ok: true, member: false, limit: 0, used: 0, remaining: 0 });
  }

  try {
    const db = await getDb('gomijoshua');
    const { ObjectId } = await import('mongodb');
    const user = await db
      .collection('users')
      .findOne(
        { _id: new ObjectId(payload.sub) },
        { projection: { role: 1, annualMemberSince: 1, monthlyMemberUntil: 1, signupPremiumTrialUntil: 1 } },
      );
    const member = isPremiumMember({
      role: user?.role as string | undefined,
      annualSince: (user?.annualMemberSince as Date | undefined) ?? null,
      monthlyUntil: (user?.monthlyMemberUntil as Date | undefined) ?? null,
      signupPremiumTrialUntil: (user?.signupPremiumTrialUntil as Date | undefined) ?? null,
    });
    if (!member) {
      return NextResponse.json({ ok: true, member: false, limit: 0, used: 0, remaining: 0 });
    }

    /* 결제한 회원과 가입 체험(7일)은 한도가 다르다 — 체험은 낮게 잡는다.
       관리자는 결제 회원과 같게 본다. */
    const paidMember =
      user?.role === 'admin' ||
      isAnnualMemberActive((user?.annualMemberSince as Date | undefined) ?? null) ||
      isMonthlyMemberActive((user?.monthlyMemberUntil as Date | undefined) ?? null);
    const limit = baseFreeQuotaFor({ paidMember });

    const { start, end } = kstMonthRange();
    const orders = await db
      .collection('orders')
      .find({
        loginId: payload.loginId,
        orderNumber: { $regex: '^(BV|MV|UV)-' },
        createdAt: { $gte: start, $lt: end },
        /* 취소한 주문은 한도를 도로 돌려줘야 한다 — 빼지 않으면 취소해도
           그 달 무료 문항이 묶인 채로 남는다. */
        status: { $ne: 'cancelled' },
      })
      .project({ orderMeta: 1, delivery: 1 })
      .toArray();

    const used = orders.reduce(
      (a, o) =>
        a +
        paidBaseCountOfOrder(
          (o as Record<string, unknown>).orderMeta as Record<string, unknown>,
          (o as Record<string, unknown>).delivery as Record<string, unknown> | null,
        ),
      0,
    );
    const remaining = Math.max(0, limit - used);
    return NextResponse.json(
      { ok: true, member: true, trial: !paidMember, limit, used, remaining },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    console.error('[variant-base-quota]', e);
    /* 조회에 실패하면 한도를 주지 않는다 — 잘못 깎아 주는 쪽이 더 위험하다. */
    return NextResponse.json({ ok: true, member: false, limit: 0, used: 0, remaining: 0 });
  }
}
