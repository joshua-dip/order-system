import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';

import { GET as usersGET } from '../users/route';
import { GET as ordersGET } from '../orders/route';
import { GET as statsGET } from '../stats/route';
import { GET as applicationsGET } from '../membership-applications/route';
import { GET as examUploadsGET } from '../past-exam-uploads/route';
import { GET as emailDraftsGET } from '../email-drafts/route';
import { GET as qnaRecentGET } from '../../qna/admin/recent/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 관리자 대시보드 첫 화면 데이터 — 한 번에.
 *
 * 예전엔 화면이 뜨면서 서로 다른 API 7개를 동시에 불렀다. Amplify 는 API 라우트마다
 * 따로 깨어나기 때문에, 한꺼번에 부르면 그만큼 인스턴스가 새로 뜨고 각각 콜드스타트를
 * 겪는다. 그래서 「관리자」를 누르면 5초씩 멈췄다.
 *
 * 실측(프로덕션):
 *   서로 다른 15개 동시   차가울 때 16.2초 / 데워진 뒤 0.84초
 *   같은 라우트 16개 동시  0.74초        ← 동시성 자체는 문제가 아니다
 *   7개 병렬 0.74/0.84/0.55초  vs  7개 순차 0.49/0.37/0.38초
 *                                 ← 병렬일수록 인스턴스가 더 뜬다
 *
 * 라우트를 하나로 모으면 깨울 것이 하나뿐이고, DB 조회는 이 한 번의 실행 안에서 병렬로 돈다.
 *
 * **로직은 각 라우트의 GET 을 그대로 호출해서 얻는다.** 복제하면 7곳이 갈라져
 * 언젠가 응답이 서로 달라진다. 여기서는 응답이 원본과 같다는 게 보장돼야 한다.
 */

type Part = { status: number; data: unknown };

/** 원본 핸들러를 같은 쿠키·같은 쿼리로 호출하고 JSON 을 꺼낸다. */
async function call(
  handler: (req: NextRequest) => Promise<Response>,
  request: NextRequest,
  path: string,
): Promise<Part> {
  try {
    const url = new URL(path, request.nextUrl.origin);
    const req = new NextRequest(url, { headers: request.headers });
    const res = await handler(req);
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  } catch (e) {
    console.error(`admin/dashboard: ${path} 실패`, e);
    /* 한 조각이 실패해도 나머지는 살린다 — 화면 전체가 비지 않도록. */
    return { status: 500, data: null };
  }
}

export async function GET(request: NextRequest) {
  /* 조각들도 각자 인증을 다시 하지만, 비관리자가 7개를 헛돌리지 않게 여기서 먼저 막는다. */
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload || payload.role !== 'admin') {
    return NextResponse.json({ error: '관리자만 이용할 수 있습니다.' }, { status: 403 });
  }

  const [users, orders, stats, applications, examUploads, emailDrafts, qnaRecent] = await Promise.all([
    call(usersGET, request, '/api/admin/users'),
    call(ordersGET, request, '/api/admin/orders?limit=100'),
    call(statsGET, request, '/api/admin/stats'),
    call(applicationsGET, request, '/api/admin/membership-applications?status=pending&limit=20'),
    call(examUploadsGET, request, '/api/admin/past-exam-uploads'),
    call(emailDraftsGET, request, '/api/admin/email-drafts?status=draft'),
    call(qnaRecentGET, request, '/api/qna/admin/recent?status=open&limit=1'),
  ]);

  return NextResponse.json(
    { ok: true, users, orders, stats, applications, examUploads, emailDrafts, qnaRecent },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
