import { NextRequest, NextResponse } from 'next/server';
import { requireVipMenu } from '@/lib/vip-menu-guard';
import { getDb } from '@/lib/mongodb';
import { WRITING_PROBLEMS_COLLECTION, formatWritingSerial } from '@/lib/vip-writing-problem-bank';
import { fetchWorksheetBlocks, buildWorksheetHtml } from '@/lib/vip-worksheet-pdf';
import { renderHtmlToPdf } from '@/lib/chromium-pdf';
import type { BankFormat } from '@/app/my/vip/grammar-problems/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** GET — 선택 범위(topicKey 여러 개)를 A4 문제지 PDF 로 다운로드 (서버 렌더, 한글 폰트 임베드). */
export async function GET(request: NextRequest) {
  const auth = await requireVipMenu(request, 'writing-problems');
  if (auth instanceof NextResponse) return auth;

  const sp = request.nextUrl.searchParams;
  const keys = sp.getAll('topicKey').filter(Boolean);
  if (keys.length === 0) return NextResponse.json({ ok: false, error: 'topicKey 가 없습니다.' }, { status: 400 });
  const fmt: BankFormat = sp.get('fmt') === 'subjective' ? 'subjective' : 'mc';
  const source = (sp.get('source') ?? '').trim();
  const category = (sp.get('category') ?? '').trim();
  const withAnswers = sp.get('answers') !== '0';

  const db = await getDb('gomijoshua');
  const blocks = await fetchWorksheetBlocks({
    db, collection: WRITING_PROBLEMS_COLLECTION, userId: auth.userId, keys, source, category, formatSerial: formatWritingSerial,
  });
  const html = buildWorksheetHtml(blocks, { fmt, withAnswers });
  const pdf = await renderHtmlToPdf(html);

  const baseName = keys.length > 1 ? '선택범위_문제지' : (blocks[0]?.title || '문제지');
  const fileName = `${baseName}.pdf`;
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'Cache-Control': 'no-store',
    },
  });
}
