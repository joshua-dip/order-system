/**
 * VIP 테마 (다크/라이트). 라이트는 다크 UI를 CSS invert 필터로 흑백 반전(globals.css .vip-light-root).
 * 클라이언트 localStorage 'vipTheme' 에 저장.
 */
export const VIP_THEME_KEY = 'vipTheme';
export type VipTheme = 'dark' | 'light';

export function getVipTheme(): VipTheme {
  if (typeof window === 'undefined') return 'dark';
  try { return localStorage.getItem(VIP_THEME_KEY) === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
}

export function setVipTheme(t: VipTheme): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(VIP_THEME_KEY, t); } catch { /* ignore */ }
}
