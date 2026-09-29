import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { loadClassKitSheet, renderClassKitSheetPdf, sheetPdfResponseHeaders } from '@/lib/class-kit-analysis-sheet';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** 관리자 클래스키트 종합분석지 — body { passageIds, format: 'html'|'pdf' } */
export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;
  const body = (await request.json().catch(() => ({}))) as { passageIds?: unknown; format?: unknown };
  const ids = (Array.isArray(body.passageIds) ? body.passageIds : []).map(String);
  if (!ids.length) return NextResponse.json({ error: '지문을 골라 주세요.' }, { status: 400 });
  const db = await getDb('gomijoshua');
  const sheet = await loadClassKitSheet(db, ids, () => true);
  if (!sheet.shown) return NextResponse.json({ error: '고른 지문에 저장된 분석이 없어요.', skipped: sheet.skipped }, { status: 404 });
  if (body.format !== 'pdf') return NextResponse.json({ html: sheet.html, shown: sheet.shown, skipped: sheet.skipped });
  const bytes = await renderClassKitSheetPdf(sheet.html);
  return new NextResponse(bytes, { status: 200, headers: sheetPdfResponseHeaders(sheet.title, bytes.byteLength) });
}
