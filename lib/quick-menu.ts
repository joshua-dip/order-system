/**
 * 자주 쓰는 메뉴 — 회원이 홈·내 정보 위쪽에 모아 두는 바로가기.
 * 항목은 홈 서비스 카탈로그(service-catalog) + 카드에 없는 도구 화면. id 로만 저장한다.
 */
import { SERVICES } from '@/lib/service-catalog';

export type QuickMenuItem = { id: string; title: string; href: string; icon: string };

const SERVICE_ICON: Record<string, string> = {
  classkit: '🧰',
  vocabulary: '📖',
  qna: '💬',
  analysis: '🔎',
  mock: '📝',
  textbook: '📚',
  gyogwaseo: '📗',
  external: '📎',
  essay: '✍️',
  'essay-workbook': '📒',
  workbook: '📓',
  ai: '🤖',
  'final-mock': '🧾',
  'order-num': '🔢',
  bundle: '📦',
  'free-variant': '🎁',
  practice: '🧩',
};

const EXTRA: QuickMenuItem[] = [
  { id: 'class-live', title: '수업 화면', href: '/class-kit/live', icon: '🖥️' },
  { id: 'class-workspace', title: '클래스키트 작업 공간', href: '/class-kit/workspace', icon: '🗂️' },
  { id: 'study-plan', title: '학습 플랜 · 시험범위', href: '/my/study-plan', icon: '🗺️' },
  { id: 'yebi-downloads', title: '내 예비시험지', href: '/unified/downloads', icon: '🗃️' },
  { id: 'my-orders', title: '주문 내역', href: '/my?tab=orders', icon: '📋' },
  { id: 'my-schools', title: '학교 관리', href: '/my?tab=schools', icon: '🏫' },
  { id: 'point-charge', title: '포인트 · 멤버십', href: '/my/point-charge', icon: '💳' },
  { id: 'guide', title: '이용안내', href: '/guide', icon: '❓' },
];

export const QUICK_MENU_ITEMS: QuickMenuItem[] = [
  ...SERVICES.map((s) => ({ id: `svc:${s.id}`, title: s.title, href: s.href, icon: SERVICE_ICON[s.id] ?? '•' })),
  ...EXTRA,
];

export const QUICK_MENU_MAX = 8;
const BY_ID = new Map(QUICK_MENU_ITEMS.map((i) => [i.id, i]));
export const quickMenuItem = (id: string) => BY_ID.get(id);

/** 저장 전 정리 — 모르는 id·중복 제거, 최대 8개 */
export function sanitizeQuickMenu(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map(String))].filter((id) => BY_ID.has(id)).slice(0, QUICK_MENU_MAX);
}

/** 아직 고른 게 없을 때 보여 줄 추천 */
export const QUICK_MENU_SUGGESTED = ['svc:mock', 'class-workspace', 'svc:final-mock', 'study-plan'];
