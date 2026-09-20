import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { runQuestionCountValidation } from '@/lib/question-count-validation';

/** 문항 재고(문제수 검증)를 돌릴 수 있는 주문 flow */
const STOCK_FLOWS = new Set(['bookVariant', 'mockVariant', 'unifiedVariant']);

const MAX_IDS = 40;
const CONCURRENCY = 3;

export type OrderStockSummary = {
  orderId: string;
  /** false면 변형 재고 집계 대상이 아님(단어장·워크북 등) */
  applicable: boolean;
  flow?: string | null;
  orderNumber?: string | null;
  ok?: boolean;
  error?: string;
  needCreateGrandTotal?: number;
  pendingReviewTotal?: number;
  needCreateShortBySum?: number;
  needCreateFromEmptyPassagesTotal?: number;
  passageCount?: number;
  requiredPerType?: number;
  typesCheckedCount?: number;
  lessonsWithoutPassageCount?: number;
  message?: string;
};

function parseOrderIds(body: unknown, searchParams: URLSearchParams): string[] {
  const fromQuery = (searchParams.get('orderIds') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (fromQuery.length > 0) return fromQuery;

  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const raw = (body as { orderIds?: unknown }).orderIds;
    if (Array.isArray(raw)) {
      return raw.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean);
    }
    if (typeof raw === 'string') {
      return raw.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  return [];
}

async function summarizeOne(orderId: string): Promise<OrderStockSummary> {
  const result = await runQuestionCountValidation({
    textbookParam: '',
    orderIdRaw: orderId,
    orderNumberRaw: null,
    requiredPerTypeRaw: null,
    questionStatusRaw: 'all',
  });

  if (!result.ok) {
    const errMsg =
      typeof result.body?.error === 'string'
        ? result.body.error
        : '재고를 확인할 수 없습니다.';
    const unsupported =
      /워크북|번호별|지원합니다|orderMeta가 없어|통합 변형\(unifiedVariant\)만/.test(errMsg);
    return {
      orderId,
      applicable: !unsupported,
      ok: false,
      error: errMsg,
    };
  }

  const flow = result.order?.flow ?? null;
  if (flow && !STOCK_FLOWS.has(flow)) {
    return {
      orderId,
      applicable: false,
      flow,
      orderNumber: result.order?.orderNumber ?? null,
    };
  }

  return {
    orderId,
    applicable: true,
    flow,
    orderNumber: result.order?.orderNumber ?? null,
    ok: true,
    needCreateGrandTotal: result.needCreateGrandTotal,
    pendingReviewTotal: result.pendingReviewTotal,
    needCreateShortBySum: result.needCreateShortBySum,
    needCreateFromEmptyPassagesTotal: result.needCreateFromEmptyPassagesTotal,
    passageCount: result.passageCount,
    requiredPerType: result.requiredPerType,
    typesCheckedCount: result.typesChecked.length,
    lessonsWithoutPassageCount: result.lessonsWithoutPassage?.length ?? 0,
    message: result.message,
  };
}

/**
 * POST/GET /api/admin/orders/stock
 * 주문별 변형 문항 재고 요약 (needCreate / pendingReview).
 * Body 또는 query: orderIds (최대 40개). BV·MV·통합변형만 집계.
 */
async function handle(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  let body: unknown = null;
  if (request.method === 'POST') {
    try {
      body = await request.json();
    } catch {
      body = null;
    }
  }

  const ids = [...new Set(parseOrderIds(body, request.nextUrl.searchParams))].slice(0, MAX_IDS);
  if (ids.length === 0) {
    return NextResponse.json({ error: 'orderIds가 필요합니다.' }, { status: 400 });
  }

  const items: OrderStockSummary[] = [];
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const chunk = ids.slice(i, i + CONCURRENCY);
    const part = await Promise.all(chunk.map((id) => summarizeOne(id)));
    items.push(...part);
  }

  const byId: Record<string, OrderStockSummary> = {};
  for (const it of items) byId[it.orderId] = it;

  const shortageCount = items.filter(
    (it) => it.applicable && it.ok && (it.needCreateGrandTotal ?? 0) > 0,
  ).length;
  const pendingReviewOrders = items.filter(
    (it) => it.applicable && it.ok && (it.pendingReviewTotal ?? 0) > 0,
  ).length;

  return NextResponse.json({
    ok: true,
    items,
    byId,
    shortageOrderCount: shortageCount,
    pendingReviewOrderCount: pendingReviewOrders,
  });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
