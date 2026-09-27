import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requirePremiumMemberVariant } from '@/lib/member-variant-premium-auth';
import { getFinalExamJob, refillJobShortages } from '@/lib/final-exam-store';
import {
  applyFinalExamOrder,
  buildFinalExamHtmlForJob,
  parseFinalExamOrder,
} from '@/lib/final-exam-render';
import { publicBaseUrl } from '@/lib/public-base-url';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 보관함 미리보기 — PDF 다운로드와 같은 HTML(lib/final-exam-render)을 그대로 돌려준다.
 * 화면은 iframe srcDoc 으로 보여 주고, 「인쇄 · PDF 저장」은 그 iframe 을 브라우저로 인쇄한다.
 *   ?kind=exam|answer  ?order=default|interleave|shuffle  ?reshuffle=1  ?source=<지문>
 * 서버 폰트 임베드(수 MB)는 넣지 않는다 — 브라우저에 있는 글꼴·웹폰트로 충분하다.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePremiumMemberVariant(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const sp = request.nextUrl.searchParams;
  const kind = sp.get('kind') === 'answer' ? 'answer' : 'exam';
  const order = parseFinalExamOrder(sp.get('order'));
  const reshuffle = sp.get('reshuffle') === '1';
  const source = (sp.get('source') || '').trim();

  try {
    const db = await getDb('gomijoshua');
    const me = await db.collection('users').findOne({ _id: auth.userId }, { projection: { loginId: 1 } });
    const loginId = typeof me?.loginId === 'string' ? me.loginId : '';
    if (!loginId) return NextResponse.json({ error: '사용자 정보를 찾을 수 없습니다.' }, { status: 404 });

    let job = await getFinalExamJob(db, id, loginId);
    if (!job) return NextResponse.json({ error: '시험지를 찾을 수 없습니다.' }, { status: 404 });
    if (job.status === 'awaiting_admin') job = await refillJobShortages(db, job);
    if (job.status !== 'ready') {
      const short = job.totalRequested - job.totalAssigned;
      return NextResponse.json(
        { error: `아직 제작 중입니다. 부족 문항 ${short}개가 완성되면 볼 수 있습니다.`, status: job.status },
        { status: 409 },
      );
    }

    job = await applyFinalExamOrder(db, job, loginId, order, reshuffle);
    const built = await buildFinalExamHtmlForJob(db, job, { kind, source, baseUrl: publicBaseUrl(request) });
    if (!built.ok) return NextResponse.json({ error: built.error }, { status: built.status });

    return new NextResponse(built.html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    console.error('[final-exams preview]', e);
    return NextResponse.json({ error: '미리보기를 만들지 못했습니다.' }, { status: 500 });
  }
}
