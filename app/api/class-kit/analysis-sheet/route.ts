import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { isClassKitTextbookAllowed, resolveClassKitAccess } from '@/lib/class-kit-access';
import { loadClassKitSheet, renderClassKitSheetPdf, sheetPdfResponseHeaders } from '@/lib/class-kit-analysis-sheet';
import { withDownloadTracking } from '@/lib/site-usage-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * 사용자 클래스키트 종합분석지 — body { passageIds, format: 'html'|'pdf' }
 * 미리보기(html)는 등급별 교재 권한 안에서 비회원도, PDF 는 로그인 회원만(다른 클래스키트 PDF 와 같다).
 */
async function handlePOST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { passageIds?: unknown; format?: unknown };
  const ids = (Array.isArray(body.passageIds) ? body.passageIds : []).map(String);
  if (!ids.length) return NextResponse.json({ error: '지문을 골라 주세요.' }, { status: 400 });
  const { level } = await resolveClassKitAccess(request);
  const wantPdf = body.format === 'pdf';
  if (wantPdf && level === 'guest') return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const db = await getDb('gomijoshua');
  const sheet = await loadClassKitSheet(db, ids, (tb) => isClassKitTextbookAllowed(tb, level));
  if (!sheet.shown) return NextResponse.json({ error: '고른 지문에 저장된 분석이 없어요.', skipped: sheet.skipped }, { status: 404 });
  if (!wantPdf) return NextResponse.json({ html: sheet.html, shown: sheet.shown, skipped: sheet.skipped });
  const bytes = await renderClassKitSheetPdf(sheet.html);
  return new NextResponse(bytes, { status: 200, headers: sheetPdfResponseHeaders(sheet.title, bytes.byteLength) });
}

export const POST = withDownloadTracking('클래스키트 종합분석지', handlePOST);
