/** 브라우저 탭·앱바 기본 제목 */
export const DEFAULT_APP_BAR_TITLE = '고미조슈아 · 교재 주문';

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

/** 쏠북(Solvook) 등 외부 브랜드/스토어 페이지 — 미설정 시 기본 쏠북 매장 */
export const SOLVOOK_BRAND_PAGE_URL =
  process.env.NEXT_PUBLIC_SOLVOOK_BRAND_URL?.trim() || 'https://solvook.com/@gomijoshua';
