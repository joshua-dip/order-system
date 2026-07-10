import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import QRCode from 'qrcode';
import { requireVipMenu } from '@/lib/vip-menu-guard';
import { getDb } from '@/lib/mongodb';
import { GRAMMAR_PROBLEMS_COLLECTION, formatGrammarSerial } from '@/lib/vip-grammar-problem-bank';
import { GRAMMAR_CONCEPTS_COLLECTION } from '@/lib/vip-grammar-concept';
import { GRAMMAR_WORKSHEETS_COLLECTION, type GrammarWorksheet } from '@/lib/vip-grammar-worksheet';
import { fetchWorksheetBlocks, buildWorksheetHtml, type WsConcept } from '@/lib/vip-worksheet-pdf';
import { renderHtmlToPdf } from '@/lib/chromium-pdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** GET — 저장된 문법 학습지를 A4 PDF 로 (QR 자가채점 포함). ?answers=0 정답지 제외 · ?qr=0 QR 제외. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireVipMenu(request, 'grammar-problems');
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: 'id 오류' }, { status: 400 });

  const db = await getDb('gomijoshua');
  const w = await db.collection<GrammarWorksheet>(GRAMMAR_WORKSHEETS_COLLECTION)
    .findOne({ _id: new ObjectId(id), userId: new ObjectId(auth.userId) });
  if (!w) return NextResponse.json({ error: '학습지를 찾을 수 없습니다.' }, { status: 404 });

  const sp = request.nextUrl.searchParams;
  const withAnswers = sp.get('answers') === '0' ? false : w.withAnswers;
  const withQr = sp.get('qr') !== '0' && w.gradableCount > 0;

  const blocks = await fetchWorksheetBlocks({
    db, collection: GRAMMAR_PROBLEMS_COLLECTION, userId: auth.userId, keys: w.topicKeys, source: w.source, category: w.category, formatSerial: formatGrammarSerial,
  });

  let concepts: Record<string, WsConcept> | undefined;
  if (w.includeConcepts) {
    const rows = await db.collection(GRAMMAR_CONCEPTS_COLLECTION).find({ userId: new ObjectId(auth.userId), topicKey: { $in: w.topicKeys } }).toArray();
    concepts = {};
    for (const r of rows) concepts[String(r.topicKey)] = { title: r.title, intro: r.intro, table: r.table, points: Array.isArray(r.points) ? r.points : [], tip: r.tip };
  }

  let qr: { dataUrl: string; caption?: string } | undefined;
  if (withQr) {
    const url = `${request.nextUrl.origin}/grade-g/${w.gradeToken}`;
    const dataUrl = await QRCode.toDataURL(url, { margin: 0, width: 220 });
    qr = { dataUrl, caption: `객관식 ${w.gradableCount}문항` };
  }

  const html = buildWorksheetHtml(blocks, { fmt: w.fmt, withAnswers, concepts, qr });
  const pdf = await renderHtmlToPdf(html);
  const fileName = `${w.title || '문법학습지'}.pdf`;
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'Cache-Control': 'no-store',
    },
  });
}
