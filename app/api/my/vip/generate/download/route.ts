import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import PDFDocument from 'pdfkit';
import {
  Document, Packer,
  Paragraph as DocxParagraph, TextRun,
  HeadingLevel, AlignmentType,
} from 'docx';
import path from 'path';
import fs from 'fs';
import { requireVip } from '@/lib/vip-auth';
import { getDb } from '@/lib/mongodb';

let fontCache: Buffer | null = null;
async function getKoreanFont(): Promise<Buffer> {
  if (fontCache) return fontCache;
  const localPath = path.join(process.cwd(), 'lib', 'fonts', 'NanumGothic-Regular.ttf');
  if (fs.existsSync(localPath)) { fontCache = fs.readFileSync(localPath); return fontCache; }
  const url = 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/nanumgothic/NanumGothic-Regular.ttf';
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (res.ok) { const buf = Buffer.from(await res.arrayBuffer()); if (buf.length > 100_000) { fontCache = buf; return fontCache; } }
  throw new Error('한글 폰트를 불러올 수 없습니다.');
}

const CIRCLED: Record<string, string> = { '①': '(1)', '②': '(2)', '③': '(3)', '④': '(4)', '⑤': '(5)' };
function safeText(s: string): string {
  let r = s.replace(/①|②|③|④|⑤/g, (m) => CIRCLED[m] || m);
  r = r.replace(/<[^>]*>/g, '');
  return r;
}

export async function GET(request: NextRequest) {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;

  const sp = request.nextUrl.searchParams;
  const format = sp.get('format') === 'docx' ? 'docx' : 'pdf';
  const ids = (sp.get('ids') || '').split(',').filter(Boolean);
  if (ids.length === 0) return NextResponse.json({ error: '문제 ID가 없습니다.' }, { status: 400 });

  const db = await getDb('gomijoshua');
  const docs = await db.collection('generated_questions')
    .find({ _id: { $in: ids.map((id) => new ObjectId(id)) }, status: '완료' })
    .toArray();

  if (docs.length === 0) return NextResponse.json({ error: '문제를 찾을 수 없습니다.' }, { status: 404 });

  if (format === 'docx') {
    const sections = docs.map((doc, idx) => {
      const qd = doc.question_data || {};
      const children = [
        new DocxParagraph({ children: [new TextRun({ text: `${idx + 1}. [${doc.type}] (${doc.difficulty})`, bold: true, size: 22 })], spacing: { after: 120 } }),
        new DocxParagraph({ children: [new TextRun({ text: safeText(qd.Paragraph || ''), size: 20 })], spacing: { after: 80 } }),
      ];
      if (qd.Options) {
        for (const line of safeText(qd.Options).split(/\n/).filter(Boolean)) {
          children.push(new DocxParagraph({ children: [new TextRun({ text: line, size: 20 })], spacing: { after: 40 } }));
        }
      }
      children.push(new DocxParagraph({ children: [new TextRun({ text: `정답: ${qd.Answer || ''}`, bold: true, size: 20, color: '2563EB' })], spacing: { before: 80, after: 40 } }));
      if (qd.Explanation) {
        children.push(new DocxParagraph({ children: [new TextRun({ text: `해설: ${safeText(qd.Explanation)}`, size: 18, italics: true, color: '6B7280' })], spacing: { after: 200 } }));
      }
      return children;
    });

    const docxDoc = new Document({
      sections: [{
        properties: {},
        children: [
          new DocxParagraph({ children: [new TextRun({ text: '변형문제', bold: true, size: 32 })], heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER, spacing: { after: 300 } }),
          ...sections.flat(),
        ],
      }],
    });

    const buf = await Packer.toBuffer(docxDoc);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': 'attachment; filename="variant_questions.docx"',
      },
    });
  }

  // PDF
  const fontBuf = await getKoreanFont();
  const pdfDoc = new PDFDocument({ size: 'A4', margins: { top: 50, bottom: 50, left: 50, right: 50 } });
  pdfDoc.registerFont('Korean', fontBuf);
  pdfDoc.font('Korean');

  const chunks: Buffer[] = [];
  pdfDoc.on('data', (c: Buffer) => chunks.push(c));

  pdfDoc.fontSize(18).text('변형문제', { align: 'center' });
  pdfDoc.moveDown(1);

  for (let i = 0; i < docs.length; i++) {
    const qd = docs[i].question_data || {};
    if (i > 0) pdfDoc.moveDown(0.5);
    if (pdfDoc.y > 700) pdfDoc.addPage();

    pdfDoc.fontSize(11).text(`${i + 1}. [${docs[i].type}] (${docs[i].difficulty})`, { continued: false });
    pdfDoc.fontSize(10).text(safeText(qd.Paragraph || ''), { lineGap: 3 });

    if (qd.Options) {
      pdfDoc.moveDown(0.3);
      for (const line of safeText(qd.Options).split(/\n/).filter(Boolean)) {
        pdfDoc.text(line);
      }
    }

    pdfDoc.moveDown(0.3);
    pdfDoc.fillColor('#2563EB').text(`정답: ${qd.Answer || ''}`, { continued: false });
    pdfDoc.fillColor('#000000');

    if (qd.Explanation) {
      pdfDoc.fontSize(9).fillColor('#6B7280').text(`해설: ${safeText(qd.Explanation)}`);
      pdfDoc.fillColor('#000000').fontSize(10);
    }

    pdfDoc.moveDown(0.5);
    pdfDoc.strokeColor('#E5E7EB').lineWidth(0.5).moveTo(50, pdfDoc.y).lineTo(545, pdfDoc.y).stroke();
  }

  pdfDoc.end();
  const pdfBuf = await new Promise<Buffer>((resolve) => pdfDoc.on('end', () => resolve(Buffer.concat(chunks))));

  return new NextResponse(new Uint8Array(pdfBuf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="variant_questions.pdf"',
    },
  });
}
