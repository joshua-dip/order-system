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

/**
 * 주문 하나가 쓴 「유료 기본난도」 문항 수. 원래 무료인 7유형·고난도는 세지 않는다.
 *
 * 지문 수는 flow 마다 다른 필드에 있다 — 부교재(BV)는 `selectedLessons`,
 * 모의고사(MV)는 `examSelections[].numbers` 다. 예전엔 `selectedLessons` 만 봐서
 * MV 주문이 지문 수만큼 통째로 빠졌고(한 회원 24 vs 실제 432), 한도가 사실상
 * 무제한처럼 동작했다. `numbers` 의 "41~42번" 은 지문 하나이므로 배열 길이를 쓴다.
 *
 * 실제로 만들지 못해 못 보낸 문항은 한도에서 빼지 않는다 — 제작기가 발송 직후
 * 남기는 `orders.delivery` 를 읽어 그만큼 줄인다. 유형별 내역(`shortfallByType`)이
 * 있으면 유료 기본난도 부족분만 정확히 빼고, 총량(`shortfall`)만 있으면 그대로 뺀다
 * (무료 유형 부족까지 돌려주게 되지만 고객에게 불리하지 않은 쪽이다).
 */
function paidBaseCountOf(
  meta: Record<string, unknown> | null | undefined,
  delivery?: Record<string, unknown> | null,
): number {
  if (!meta) return 0;
  const types = Array.isArray(meta.selectedTypes)
    ? (meta.selectedTypes as unknown[]).filter((t): t is string => typeof t === 'string')
    : [];
  const lessons = Array.isArray(meta.selectedLessons) ? (meta.selectedLessons as unknown[]).length : 0;
  const examNumbers = Array.isArray(meta.examSelections)
    ? (meta.examSelections as unknown[]).reduce((sum: number, e) => {
        const nums = (e as { numbers?: unknown })?.numbers;
        return sum + (Array.isArray(nums) ? nums.length : 0);
      }, 0)
    : 0;
  const per = meta.questionsPerType;
  const mult = Math.max(1, lessons || examNumbers);
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
  if (n <= 0) return 0;

  if (delivery && typeof delivery === 'object') {
    const byType = (delivery as { shortfallByType?: unknown }).shortfallByType;
    if (byType && typeof byType === 'object' && !Array.isArray(byType)) {
      let short = 0;
      for (const [t, v] of Object.entries(byType as Record<string, unknown>)) {
        if (isFreeVariantType(t) || isAdvancedVariantType(t)) continue;
        const c = Number(v);
        if (Number.isFinite(c) && c > 0) short += Math.floor(c);
      }
      return Math.max(0, n - short);
    }
    const total = Number((delivery as { shortfall?: unknown }).shortfall);
    if (Number.isFinite(total) && total > 0) return Math.max(0, n - Math.floor(total));
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
        /* 취소한 주문은 한도를 도로 돌려줘야 한다 — 빼지 않으면 취소해도
           그 달 무료 문항이 묶인 채로 남는다. */
        status: { $ne: 'cancelled' },
      })
      .project({ orderMeta: 1, delivery: 1 })
      .toArray();

    const used = orders.reduce(
      (a, o) =>
        a +
        paidBaseCountOf(
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
