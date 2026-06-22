/** VIP 경로 → 메뉴 id 매핑 (사이드바·게이트 공용). */
export function pathToMenuId(pathname: string): string {
  if (pathname.startsWith('/my/vip/menu-store')) return 'menu-store';
  if (pathname === '/my/vip') return 'dashboard';
  if (pathname.startsWith('/my/vip/questions')) return 'questions';
  if (pathname.startsWith('/my/vip/generate')) return 'generate';
  if (pathname.startsWith('/my/vip/attendance')) return 'attendance';
  if (pathname.startsWith('/my/vip/students')) return 'students';
  if (pathname.startsWith('/my/vip/exams')) return 'exams';
  if (pathname.startsWith('/my/vip/scores')) return 'scores';
  if (pathname.startsWith('/my/vip/analysis')) return 'analysis';
  return 'dashboard';
}

/** 권한 검사를 건너뛰는(항상 허용) 메뉴. */
export const GATE_EXEMPT_MENU_IDS = new Set(['dashboard', 'menu-store']);
