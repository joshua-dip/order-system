import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import {
  buildOrderVariantPdfZip,
  parseOrderPdfSplitModes,
  type OrderPdfSplitMode,
} from '@/lib/order-variant-pdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** 회차·번호·카테고리별 다건 PDF → ZIP. Lambda 여유. */
export const maxDuration = 300;

/**
 * GET /api/admin/orders/[id]/pdf
 * 주문 범위의 완료 변형문항을 회원 인쇄 양식 PDF ZIP으로 내려받는다.
 *
 * Query:
 * - modes: byCategory,byRound,bySourceNumber,singleFull,byRoundCategory (콤마 구분, 복수 가능)
 * - by: 구버전 단일 모드(type|round|round-type|source|full) — modes 없을 때
 * - fromOrderHwp=1: 주문서 hwpStorageModes 로 모드 추론 (modes/by 없을 때 기본)
 * - typeOrder: exam(기본) | order
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { id } = await context.params;
  const orderId = (id || '').trim();
  if (!orderId) {
    return NextResponse.json({ error: '주문 id가 필요합니다.' }, { status: 400 });
  }

  const sp = request.nextUrl.searchParams;
  const modesParam = sp.get('modes')?.trim() || '';
  const byParam = sp.get('by')?.trim() || '';
  const fromOrderHwp = sp.get('fromOrderHwp') !== '0';
  const typeOrder = sp.get('typeOrder') === 'order' ? 'order' : 'exam';

  let modes: OrderPdfSplitMode[] | undefined;
  if (modesParam) modes = parseOrderPdfSplitModes(modesParam);
  else if (byParam) modes = parseOrderPdfSplitModes(byParam);

  try {
    const result = await buildOrderVariantPdfZip({
      orderId,
      modes,
      by: byParam || null,
      fromOrderHwp: !modesParam && !byParam ? fromOrderHwp : false,
      typeOrder,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const zipName = `${result.orderNumber}.zip`;
    const fallback = `order-${orderId.slice(-8)}.zip`;
    return new NextResponse(new Uint8Array(result.zip), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Length': String(result.zip.byteLength),
        'Content-Disposition': `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(zipName)}`,
        'Cache-Control': 'no-store',
        'X-Order-Pdf-Files': String(result.fileCount),
        'X-Order-Pdf-Questions': String(result.questionCount),
        'X-Order-Pdf-Missing': String(result.missingSlots),
        'X-Order-Pdf-Modes': result.modes.join(','),
      },
    });
  } catch (e) {
    console.error('admin order pdf:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'PDF 생성 중 오류가 발생했습니다.' },
      { status: 500 },
    );
  }
}
