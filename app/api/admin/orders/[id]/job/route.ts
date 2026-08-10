import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { buildVariantJob, estimateQuestionCount, type VariantOrderMeta } from '@/lib/variant-job';

/**
 * 주문 → 제작기 job JSON.
 *
 * 운영자가 이 응답을 파일로 저장해 그대로 실행한다:
 *   python multi_job_runner.py --job <저장한 파일>
 *
 * 계약은 schemas/variant-job.schema.json 이며 러너가 실행 전에 같은 스키마로 검증한다.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const token = request.cookies.get(COOKIE_NAME)?.value;
    if (!token) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }
    const payload = await verifyToken(token);
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
    }

    // 동적 세그먼트는 형제 라우트([id]/send-email 등)와 이름이 같아야 한다 — 값은 주문번호다
    const { id: orderNumber } = await params;
    const db = await getDb('gomijoshua');
    const order = await db.collection('orders').findOne({ orderNumber });
    if (!order) {
      return NextResponse.json({ error: `주문 없음: ${orderNumber}` }, { status: 404 });
    }

    const meta = (order.orderMeta ?? {}) as VariantOrderMeta;
    if (meta.flow !== 'bookVariant') {
      return NextResponse.json(
        { error: `변형문제 주문이 아닙니다 (flow=${meta.flow ?? '없음'})` },
        { status: 400 }
      );
    }

    const url = new URL(request.url);
    const hwpTemplatePath = url.searchParams.get('template') ?? undefined;

    let job;
    try {
      job = buildVariantJob(orderNumber, meta, { hwpTemplatePath });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : String(e) },
        { status: 422 }
      );
    }

    return NextResponse.json({
      orderNumber,
      status: order.status ?? null,
      estimatedQuestions: estimateQuestionCount(meta),
      needsCustomTemplate: Boolean(meta.useCustomHwp),
      job,
    });
  } catch (e) {
    console.error('[admin/orders/job] 실패', e);
    return NextResponse.json({ error: '서버 오류' }, { status: 500 });
  }
}
