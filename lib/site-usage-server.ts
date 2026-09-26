/**
 * 서버에서 남기는 사용 기록 — 파일 다운로드처럼 클라이언트 버튼이 여러 곳에 흩어진 행동은
 * 실제로 파일을 만들어 내는 API 에서 한 번에 기록한다(버튼마다 trackEvent 를 다는 것보다 빠짐이 없다).
 */
import type { NextRequest } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { koreaDateKey } from '@/lib/korea-date-key';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import {
  SITE_EVENTS_COLLECTION,
  ensureSiteEventIndexes,
  normalizeUsagePath,
  sanitizeProps,
  usageMenuOf,
  type SiteEventDoc,
} from '@/lib/site-usage';

/** 요청한 화면 경로 — Referer 가 같은 사이트면 그 경로, 아니면 API 경로 */
function pagePathOf(request: NextRequest): string {
  try {
    const ref = request.headers.get('referer');
    if (ref) {
      const u = new URL(ref);
      if (u.host === request.nextUrl.host) return u.pathname;
    }
  } catch {
    /* ignore */
  }
  return request.nextUrl.pathname;
}

export async function recordServerEvent(
  request: NextRequest,
  name: string,
  props?: Record<string, string | number | boolean | undefined>,
): Promise<void> {
  const path = normalizeUsagePath(pagePathOf(request));
  if (path.startsWith('/admin')) return;
  const db = await getDb('gomijoshua');
  await ensureSiteEventIndexes(db);
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const session = token ? await verifyToken(token) : null;
  const clean = sanitizeProps(props);
  const doc: SiteEventDoc = {
    ts: new Date(),
    date: koreaDateKey(),
    type: 'event',
    name,
    path,
    menu: usageMenuOf(path).key,
    visitorId: request.cookies.get('sv_id')?.value?.trim() || 'server',
    ...(session?.loginId ? { loginId: String(session.loginId), role: String(session.role ?? '') } : {}),
    ...(clean ? { props: clean } : {}),
  };
  await db.collection(SITE_EVENTS_COLLECTION).insertOne(doc);
}

/**
 * 파일을 내려주는 라우트를 감싼다 — 성공 응답이 PDF·ZIP·문서 파일이면 file_download 로 남긴다.
 * 기록은 최대 1.5초만 기다리고, 실패해도 다운로드 응답은 그대로 돌려준다.
 *
 *   async function handleGET(req: NextRequest) { … }
 *   export const GET = withDownloadTracking('클래스키트 수업용', handleGET);
 */
export function withDownloadTracking<A extends unknown[]>(
  kind: string,
  handler: (request: NextRequest, ...rest: A) => Promise<Response>,
): (request: NextRequest, ...rest: A) => Promise<Response> {
  return async (request: NextRequest, ...rest: A) => {
    const res = await handler(request, ...rest);
    try {
      const ct = res.headers.get('content-type') || '';
      if (res.ok && /pdf|zip|octet-stream|officedocument|hwp|msword|excel/i.test(ct)) {
        const format = /pdf/i.test(ct) ? 'pdf' : /zip/i.test(ct) ? 'zip' : 'file';
        await Promise.race([
          recordServerEvent(request, 'file_download', { kind, format, api: request.nextUrl.pathname }),
          new Promise((r) => setTimeout(r, 1500)),
        ]);
      }
    } catch (e) {
      console.error('download tracking:', e);
    }
    return res;
  };
}
