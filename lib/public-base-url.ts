import type { NextRequest } from 'next/server';
import { getPublicSiteUrl } from '@/lib/site-branding';

/**
 * 외부에 노출되는 공개 베이스 URL (QR·이메일 링크 등 인쇄·전달용).
 * 인쇄된 QR은 영구적이므로 내부 요청 origin(localhost 등)이 아니라
 * 반드시 배포 도메인을 가리켜야 한다.
 *
 * 우선순위:
 *  1) NEXT_PUBLIC_SITE_URL (배포 시 명시 — getPublicSiteUrl, 프로젝트 표준)
 *  2) 프록시 헤더 x-forwarded-host(+proto)
 *  3) request origin (최후의 폴백 — 로컬 개발 등)
 */
export function publicBaseUrl(request: NextRequest): string {
  const configured = getPublicSiteUrl();
  if (configured) return configured.replace(/\/+$/, '');

  const fwdHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  if (fwdHost) {
    const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'https';
    return `${proto}://${fwdHost}`;
  }

  return request.nextUrl.origin;
}
