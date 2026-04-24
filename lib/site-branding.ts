/** 브라우저 탭·앱바 기본 제목 */
export const DEFAULT_APP_BAR_TITLE = '고미조슈아 · 교재 주문';

/** 앱바 배경 — DAVICHI 계열(좌 브라운 골드 → 우 퍼플), 하단 액센트 틸 */
export const APP_BAR_GRADIENT_START = '#A67C52';
export const APP_BAR_GRADIENT_END = '#7E4A8D';
export const APP_BAR_ACCENT_LINE = '#169B8F';

/**
 * 공개 사이트 절대 URL (프로덕션).
 * Amplify/Vercel 등에 `NEXT_PUBLIC_SITE_URL=https://실제도메인` 설정 → OG·metadataBase·이메일 등에서 동일 도메인 사용.
 */
export function getPublicSiteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!raw) return '';
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}`;
  } catch {
    return '';
  }
}

/** Next.js `metadataBase` — 미설정 시 로컬 기본값 */
export function getMetadataBase(): URL {
  const origin = getPublicSiteUrl();
  if (origin) {
    try {
      return new URL(origin.endsWith('/') ? origin : `${origin}/`);
    } catch {
      /* fallthrough */
    }
  }
  return new URL('http://localhost:3000');
}

/** 쏠북(Solvook) 고미조슈아 브랜드 페이지 */
export const SOLVOOK_BRAND_PAGE_URL = 'https://solvook.com/@gomijoshua';
