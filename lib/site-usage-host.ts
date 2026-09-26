import type { NextRequest } from 'next/server';

/**
 * 이 사이트 자신의 호스트인지. 배포(Amplify)에서는 request.nextUrl.host 가 실제 도메인(gomijoshua.com)이 아닐 수 있어
 * Host·X-Forwarded-Host 헤더와 알려진 도메인까지 함께 본다.
 */
export function isOwnHost(request: NextRequest, host: string): boolean {
  const h = host.trim().toLowerCase();
  if (!h) return false;
  if (/(^|\.)gomijoshua\.com$/.test(h) || /^localhost(:\d+)?$/.test(h) || /^127\.0\.0\.1(:\d+)?$/.test(h)) return true;
  const own = [request.nextUrl.host, request.headers.get('host'), request.headers.get('x-forwarded-host')]
    .filter((x): x is string => !!x)
    .map((x) => x.split(',')[0].trim().toLowerCase());
  return own.includes(h);
}
