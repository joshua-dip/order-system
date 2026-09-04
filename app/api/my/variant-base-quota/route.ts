import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { isPremiumMember, isMonthlyMemberActive } from '@/lib/premium-member';
import { isAnnualMemberActive } from '@/lib/annual-member';
import { isFreeVariantType, isAdvancedVariantType } from '@/lib/variant-pricing';
import { baseFreeQuotaFor, kstMonthRange } from '@/lib/variant-member-quota';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 이번 달 기본난도 무료 한도 잔량.
 *
 * 사용량은 별도 장부를 두지 않고 이번 달 변형문제 주문(BV/MV/UV)의 orderMeta 에서
 * 되센다 — 장부를 따로 두면 주문 취소·수정 때 실제와 어긋난다.
 */

/** 주문 하나가 쓴 「유료 기본난도」 문항 수. 원래 무료인 7유형·고난도는 세지 않는다. */
function paidBaseCountOf(meta: Record<string, unknown> | null | undefined): number {
  if (!meta) return 0;
  const types = Array.isArray(meta.selectedTypes)
    ? (meta.selectedTypes as unknown[]).filter((t): t is string => typeof t === 'string')
    : [];
  const lessons = Array.isArray(meta.selectedLessons) ? (meta.selectedLessons as unknown[]).length : 0;
  const per = meta.questionsPerType;
  const mult = Math.max(1, lessons);
  let n = 0;
  for (const t of types) {
    if (isFreeVariantType(t) || isAdvancedVariantType(t)) continue;
    const raw =
      typeof per === 'number'
        ? per
        : per && typeof per === 'object'
          ? Number((per as Record<string, unknown>)[t])
          : 1;
    n += (Number.isFinite(raw) && raw > 0 ? raw : 1) * mult;
  }
  return n;
}

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
      })
      .project({ orderMeta: 1 })
      .toArray();

    const used = orders.reduce(
      (a, o) => a + paidBaseCountOf((o as Record<string, unknown>).orderMeta as Record<string, unknown>),
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
