'use client';

/** /api/my/vip/menus 응답 1건 (메뉴 카탈로그 + 권한). */
export interface VipMenuEntry {
  id: string;
  label: string;
  paid: boolean;
  price: number;
  unlocked: boolean;
  requires: string[];
}

// 세션 캐시 — 레이아웃 게이트·사이드바가 동일 요청을 공유. 구매 후엔 페이지 리로드로 모듈 상태가 초기화됨.
let cache: Promise<VipMenuEntry[]> | null = null;

export function fetchVipMenus(): Promise<VipMenuEntry[]> {
  if (!cache) {
    cache = fetch('/api/my/vip/menus', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => (d?.ok && Array.isArray(d.menus) ? (d.menus as VipMenuEntry[]) : []))
      .catch(() => []);
  }
  return cache;
}

export function clearVipMenusCache() {
  cache = null;
}
