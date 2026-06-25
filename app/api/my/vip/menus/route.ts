import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVip } from '@/lib/vip-auth';
import { getDb } from '@/lib/mongodb';
import { recordPointLedger } from '@/lib/point-ledger';
import {
  VIP_MENU_CATALOG,
  VIP_MENU_IDS,
  VIP_MENU_STORE_SETTINGS_ID,
  isMenuPaid,
  isMenuPublished,
  isMenuPurchasable,
  isVipAllAccess,
  menuPrice,
  effectiveRequires,
  type VipMenuStoreConfig,
} from '@/lib/vip-menu-catalog';
import { isVipSubscriptionActive, VIP_SUBSCRIPTION_MONTHLY_WON } from '@/lib/vip-subscription';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function loadConfig(db: Awaited<ReturnType<typeof getDb>>): Promise<VipMenuStoreConfig> {
  const doc = await db.collection('settings').findOne({ _id: VIP_MENU_STORE_SETTINGS_ID } as unknown as Record<string, unknown>);
  return (doc?.value && typeof doc.value === 'object') ? (doc.value as VipMenuStoreConfig) : {};
}

/** GET — 메뉴 카탈로그 + 가격 + 보유 포인트 + 내가 언락한 메뉴 */
export async function GET(request: NextRequest) {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;
  const db = await getDb('gomijoshua');
  const userId = new ObjectId(auth.userId);
  const [config, user] = await Promise.all([
    loadConfig(db),
    db.collection('users').findOne({ _id: userId }, { projection: { points: 1, vipMenus: 1, vipSubscriptionUntil: 1 } }),
  ]);
  const points = typeof user?.points === 'number' && user.points >= 0 ? user.points : 0;
  const unlocked: string[] = Array.isArray(user?.vipMenus) ? (user!.vipMenus as string[]) : [];
  // 활성 월 구독 중이면 모든 유료 메뉴를 사용 가능(언락 취급).
  const subUntil = (user as { vipSubscriptionUntil?: Date } | null)?.vipSubscriptionUntil ?? null;
  const subscribed = isVipSubscriptionActive(subUntil);
  // 테스트 계정(조슈아)은 전 메뉴 접근.
  const allAccess = isVipAllAccess(auth.loginId);
  return NextResponse.json({
    ok: true,
    points,
    allAccess,
    subscription: { active: subscribed, until: subUntil, monthlyWon: VIP_SUBSCRIPTION_MONTHLY_WON },
    menus: VIP_MENU_CATALOG.map((m) => ({
      id: m.id,
      label: m.label,
      paid: isMenuPaid(config, m.id),
      price: menuPrice(config, m.id),
      published: isMenuPublished(config, m.id),
      purchasable: isMenuPurchasable(config, m.id),
      unlocked: allAccess || subscribed || unlocked.includes(m.id),
      requires: effectiveRequires(config, m.id),
    })),
  });
}

/** POST — 메뉴 언락 ({ menuId }) : 포인트 차감 후 vipMenus 에 추가 */
export async function POST(request: NextRequest) {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;
  let body: { menuId?: unknown; menuIds?: unknown };
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }); }
  // menuIds(배열, 함께 구매) 또는 menuId(단건) 둘 다 허용
  const reqIds = Array.isArray(body.menuIds) ? body.menuIds.map(String) : (body.menuId ? [String(body.menuId)] : []);
  const valid = [...new Set(reqIds)].filter((id) => VIP_MENU_IDS.has(id));
  if (valid.length === 0) return NextResponse.json({ error: '알 수 없는 메뉴입니다.' }, { status: 400 });

  const db = await getDb('gomijoshua');
  const userId = new ObjectId(auth.userId);
  const config = await loadConfig(db);

  const user = await db.collection('users').findOne({ _id: userId }, { projection: { points: 1, vipMenus: 1 } });
  const unlocked: string[] = Array.isArray(user?.vipMenus) ? (user!.vipMenus as string[]) : [];
  const points = typeof user?.points === 'number' && user.points >= 0 ? user.points : 0;

  // 비공개(미공개) 유료 메뉴는 구매 불가
  const blocked = valid.filter((id) => isMenuPaid(config, id) && !unlocked.includes(id) && !isMenuPublished(config, id));
  if (blocked.length > 0) return NextResponse.json({ error: '아직 공개되지 않은 메뉴는 구매할 수 없습니다.', code: 'menu_unpublished', menuIds: blocked }, { status: 403 });
  // 구매 가능(유료+공개)·미보유 메뉴만 실제 구매 대상
  const toBuy = valid.filter((id) => isMenuPurchasable(config, id) && !unlocked.includes(id));
  if (toBuy.length === 0) return NextResponse.json({ ok: true, already: true, points });
  const total = toBuy.reduce((s, id) => s + menuPrice(config, id), 0);
  if (points < total) return NextResponse.json({ error: '포인트가 부족합니다.', need: total, have: points }, { status: 402 });

  // 합계 차감 + 일괄 언락 (원자적: 잔액 충분일 때만)
  const r = await db.collection('users').updateOne(
    { _id: userId, points: { $gte: total } },
    { $inc: { points: -total }, $addToSet: { vipMenus: { $each: toBuy } } },
  );
  if (r.modifiedCount === 0) return NextResponse.json({ error: '구매 처리에 실패했습니다. 잔액을 확인해주세요.' }, { status: 409 });

  const after = await db.collection('users').findOne({ _id: userId }, { projection: { points: 1 } });
  const balanceAfter = typeof after?.points === 'number' ? after.points : Math.max(0, points - total);
  for (const id of toBuy) {
    await recordPointLedger(db, { userId, delta: -menuPrice(config, id), balanceAfter, kind: 'vip_menu_unlock', meta: { menuId: id, price: menuPrice(config, id) } });
  }
  return NextResponse.json({ ok: true, bought: toBuy, spent: total, points: balanceAfter });
}
