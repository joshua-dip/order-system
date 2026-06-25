import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVip, type VipUser } from './vip-auth';
import { getDb } from './mongodb';
import { VIP_MENU_STORE_SETTINGS_ID, isMenuAccessible, isVipAllAccess, type VipMenuStoreConfig } from './vip-menu-catalog';
import { isVipSubscriptionActive } from './vip-subscription';

/**
 * 메뉴 단위 접근 권한 서버 검사 (paywall 하드 게이트).
 * requireVip 통과 후, 해당 메뉴가 유료인데 미구매면 403(code: 'menu_locked').
 * 무료 메뉴/구매한 메뉴는 통과. DB 오류 시 fail-open (정상 사용자 잠금 방지).
 */
export async function requireVipMenu(
  request: NextRequest,
  menuId: string,
): Promise<VipUser | NextResponse> {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;
  // 테스트 계정(조슈아)은 모든 메뉴 통과.
  if (isVipAllAccess(auth.loginId)) return auth;
  try {
    const db = await getDb('gomijoshua');
    const userId = new ObjectId(auth.userId);
    const [doc, user] = await Promise.all([
      db.collection('settings').findOne({ _id: VIP_MENU_STORE_SETTINGS_ID } as unknown as Record<string, unknown>),
      db.collection('users').findOne({ _id: userId }, { projection: { vipMenus: 1, vipSubscriptionUntil: 1 } }),
    ]);
    // 활성 월 구독 중이면 모든 메뉴 통과.
    if (isVipSubscriptionActive((user as { vipSubscriptionUntil?: Date } | null)?.vipSubscriptionUntil)) return auth;
    const config: VipMenuStoreConfig = (doc?.value && typeof doc.value === 'object') ? (doc.value as VipMenuStoreConfig) : {};
    const userMenus: string[] = Array.isArray(user?.vipMenus) ? (user!.vipMenus as string[]) : [];
    if (isMenuAccessible(menuId, config, userMenus)) return auth;
    return NextResponse.json(
      { error: '구매가 필요한 메뉴입니다.', code: 'menu_locked', menuId },
      { status: 403 },
    );
  } catch {
    return auth; // 검사 실패 시 통과(잠금 사고 방지)
  }
}
