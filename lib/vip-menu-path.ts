/** VIP 경로 → 메뉴 id 매핑 (사이드바·게이트 공용). */
export function pathToMenuId(pathname: string): string {
  if (pathname.startsWith('/my/vip/menu-store')) return 'menu-store';
  if (pathname === '/my/vip') return 'dashboard';
  if (pathname.startsWith('/my/vip/qbank-api')) return 'qbank-api';
  if (pathname.startsWith('/my/vip/review')) return 'review';
  if (pathname.startsWith('/my/vip/homework')) return 'homework';
  if (pathname.startsWith('/my/vip/report')) return 'report';
  if (pathname.startsWith('/my/vip/tuition')) return 'tuition';
  if (pathname.startsWith('/my/vip/counseling')) return 'counseling';
  if (pathname.startsWith('/my/vip/lessons')) return 'lessons';
  if (pathname.startsWith('/my/vip/videos')) return 'videos';
  if (pathname.startsWith('/my/vip/materials')) return 'materials';
  if (pathname.startsWith('/my/vip/words')) return 'words';
  if (pathname.startsWith('/my/vip/assessments')) return 'assessments';
  if (pathname.startsWith('/my/vip/forms')) return 'forms';
  if (pathname.startsWith('/my/vip/inventory')) return 'inventory';
  if (pathname.startsWith('/my/vip/expenses')) return 'expenses';
  if (pathname.startsWith('/my/vip/academy')) return 'academy';
  if (pathname.startsWith('/my/vip/school-info')) return 'school-info';
  if (pathname.startsWith('/my/vip/payroll')) return 'payroll';
  if (pathname.startsWith('/my/vip/admissions')) return 'admissions';
  if (pathname.startsWith('/my/vip/schedule')) return 'schedule';
  if (pathname.startsWith('/my/vip/memo')) return 'memo';
  if (pathname.startsWith('/my/vip/writing')) return 'writing';
  if (pathname.startsWith('/my/vip/dictionary')) return 'dictionary';
  if (pathname.startsWith('/my/vip/class-kit')) return 'class-kit';
  if (pathname.startsWith('/my/vip/passage-analysis')) return 'passage-analysis';
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
