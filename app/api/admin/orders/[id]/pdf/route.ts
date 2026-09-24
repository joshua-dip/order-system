import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import {
  buildOrderVariantPdfZip,
  parseOrderPdfSplitModes,
  planOrderVariantPdf,
  renderOrderVariantPdfFile,
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
 * - plan=1  : 렌더 없이 파일 목록만 JSON { orderNumber, files:[{ index, name }], … }
 * - file=<n>: plan 의 n 번째 파일 하나만 PDF 로
 *
 * 배포(Amplify)는 요청 하나가 30초를 넘기면 끊긴다(maxDuration 과 무관). 여러 방식을 고르면 PDF 가
 * 수십 개라 한 요청에 다 못 만든다 → 화면은 plan 으로 목록을 받고 file 로 하나씩 받아 브라우저에서 ZIP 으로 묶는다.
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

  const planInput = {
    orderId,
    modes,
    by: byParam || null,
    fromOrderHwp: !modesParam && !byParam ? fromOrderHwp : false,
    typeOrder,
  } as const;

  if (sp.get('plan') === '1' || sp.has('file')) {
    try {
      const plan = await planOrderVariantPdf(planInput);
      if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: plan.status });
      if (sp.get('plan') === '1') {
        return NextResponse.json(
          {
            ok: true,
            orderNumber: plan.orderNumber,
            files: plan.names.map((name, index) => ({ index, name })),
            questionCount: plan.questionCount,
            missingSlots: plan.missingSlots,
            modes: plan.modes,
          },
          { headers: { 'Cache-Control': 'no-store' } },
        );
      }
      const index = Number(sp.get('file'));
      if (!Number.isInteger(index) || index < 0 || index >= plan.entries.length) {
        return NextResponse.json({ error: '파일 번호가 범위를 벗어났습니다.' }, { status: 400 });
      }
      const pdf = await renderOrderVariantPdfFile(plan.entries[index].html);
      return new NextResponse(new Uint8Array(pdf), {
        status: 200,
        headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store' },
      });
    } catch (e) {
      console.error('admin order pdf (plan/file):', e);
      return NextResponse.json({ error: e instanceof Error ? e.message : 'PDF 생성 중 오류가 발생했습니다.' }, { status: 500 });
    }
  }

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
