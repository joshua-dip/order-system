import { NextRequest, NextResponse } from 'next/server';
import { runVariantAutoFillBatch } from '@/lib/variant-scheduled-batch';

/** 한 번에 여러 Claude 호출 — Vercel 등에서 상한 조정 */
export const maxDuration = 300;

/**
 * 스케줄러 전용: 부족 문항을 Claude API로 생성해 DB에 저장 (status 대기).
 * POST + 헤더 인증. 본문 JSON: { textbook?, orderId?, orderNumber?, maxGenerations?, … }
 */
export async function POST(request: NextRequest) {
  const secret = process.env.VARIANT_CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { error: 'VARIANT_CRON_SECRET 이 설정되지 않았습니다. 배포 환경 변수를 확인하세요.' },
      { status: 503 }
    );
  }

  const auth = request.headers.get('authorization');
  const bearer = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const headerSecret = request.headers.get('x-variant-cron-secret')?.trim() ?? '';
  if (bearer !== secret && headerSecret !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY 가 필요합니다.' }, { status: 503 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const textbook =
    typeof body.textbook === 'string' ? body.textbook.trim() : '';
  const orderId = typeof body.orderId === 'string' ? body.orderId.trim() : '';
  const orderNumber = typeof body.orderNumber === 'string' ? body.orderNumber.trim() : '';
  const maxGenerations =
    typeof body.maxGenerations === 'number' && Number.isFinite(body.maxGenerations)
      ? Math.floor(body.maxGenerations)
      : typeof body.maxGenerations === 'string'
        ? parseInt(body.maxGenerations, 10)
        : 3;
  const questionStatus =
    typeof body.questionStatus === 'string' ? body.questionStatus.trim() : 'all';
  const requiredPerType =
    body.requiredPerType != null ? String(body.requiredPerType) : null;

  const result = await runVariantAutoFillBatch({
    textbookParam: textbook,
    orderIdRaw: orderId,
    orderNumberRaw: orderNumber || null,
    requiredPerTypeRaw: requiredPerType,
    questionStatusRaw: questionStatus || 'all',
    maxGenerations: Number.isFinite(maxGenerations) ? maxGenerations : 3,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status && result.status >= 400 ? result.status : 400 }
    );
  }

  return NextResponse.json(result);
}
