import * as XLSX from 'xlsx';
import PDFDocument from 'pdfkit';
import {
  Document,
  Packer,
  Paragraph as DocxParagraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
} from 'docx';
import path from 'path';
import fs from 'fs';

const CIRCLED: Record<string, string> = {
  '①': '(1)',
  '②': '(2)',
  '③': '(3)',
  '④': '(4)',
  '⑤': '(5)',
};

let fontCache: Buffer | null = null;

export async function getKoreanFontBuffer(): Promise<Buffer> {
  if (fontCache) return fontCache;
  const localPath = path.join(process.cwd(), 'lib', 'fonts', 'NanumGothic-Regular.ttf');
  if (fs.existsSync(localPath)) {
    fontCache = fs.readFileSync(localPath);
    return fontCache;
  }
  const url = 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/nanumgothic/NanumGothic-Regular.ttf';
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (res.ok) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 100_000) {
      fontCache = buf;
      return fontCache;
    }
  }
  throw new Error('한글 폰트를 불러올 수 없습니다.');
}

export function safeExportText(s: string): string {
  let r = s.replace(/①|②|③|④|⑤/g, (m) => CIRCLED[m] || m);
  r = r.replace(/<[^>]*>/g, '');
  return r;
}

export type MemberVariantExportDoc = {
  _id?: unknown;
  type?: string;
  difficulty?: string;
  textbook?: string;
  source?: string;
  status?: string;
  created_at?: Date;
  question_data?: Record<string, unknown>;
};

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

export function flattenMemberQuestionData(qd: Record<string, unknown>): {
  question: string;
  paragraph: string;
  optionsRaw: string;
  optionsDisplay: string;
  answer: string;
  explanation: string;
} {
  const question = str(qd.Question).trim();
  const paragraph = str(qd.Paragraph).trim();
  const optionsRaw = str(qd.Options).trim();
  const optionsDisplay = optionsRaw.replace(/\s*###\s*/g, '\n');
  const answer = (str(qd.CorrectAnswer).trim() || str(qd.Answer).trim()).trim();
  const explanation = str(qd.Explanation).trim();
  return { question, paragraph, optionsRaw, optionsDisplay, answer, explanation };
}

export async function buildMemberVariantXlsxBuffer(docs: MemberVariantExportDoc[]): Promise<Buffer> {
  const rows: (string | number)[][] = [
    [
      '번호',
      '유형',
      '난이도',
      '교재',
      '출처',
      '상태',
      '저장일시',
      '발문',
      '지문',
      '선택지',
      '정답',
      '해설',
    ],
  ];
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i];
    const qd = d.question_data ?? {};
    const f = flattenMemberQuestionData(qd);
    const created =
      d.created_at instanceof Date
        ? d.created_at.toISOString().replace('T', ' ').slice(0, 19)
        : '';
    rows.push([
      i + 1,
      safeExportText(str(d.type)),
      safeExportText(str(d.difficulty)),
      safeExportText(str(d.textbook)),
      safeExportText(str(d.source)),
      safeExportText(str(d.status)),
      created,
      safeExportText(f.question),
      safeExportText(f.paragraph),
      safeExportText(f.optionsDisplay),
      safeExportText(f.answer),
      safeExportText(f.explanation),
    ]);
  }
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, '문항');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

export async function buildMemberVariantDocxBuffer(docs: MemberVariantExportDoc[]): Promise<Buffer> {
  const sections = docs.map((doc, idx) => {
    const f = flattenMemberQuestionData(doc.question_data ?? {});
    const children = [
      new DocxParagraph({
        children: [
          new TextRun({
            text: `${idx + 1}. [${safeExportText(str(doc.type))}] (${safeExportText(str(doc.difficulty))}) · ${safeExportText(str(doc.textbook))}`,
            bold: true,
            size: 22,
          }),
        ],
        spacing: { after: 120 },
      }),
    ];
    if (f.question) {
      children.push(
        new DocxParagraph({
          children: [new TextRun({ text: `발문: ${safeExportText(f.question)}`, size: 20 })],
          spacing: { after: 80 },
        }),
      );
    }
    if (f.paragraph) {
      children.push(
        new DocxParagraph({
          children: [new TextRun({ text: safeExportText(f.paragraph), size: 20 })],
          spacing: { after: 80 },
        }),
      );
    }
    if (f.optionsDisplay) {
      for (const line of safeExportText(f.optionsDisplay).split(/\n/).filter(Boolean)) {
        children.push(
          new DocxParagraph({ children: [new TextRun({ text: line, size: 20 })], spacing: { after: 40 } }),
        );
      }
    }
    children.push(
      new DocxParagraph({
        children: [new TextRun({ text: `정답: ${safeExportText(f.answer)}`, bold: true, size: 20, color: '2563EB' })],
        spacing: { before: 80, after: 40 },
      }),
    );
    if (f.explanation) {
      children.push(
        new DocxParagraph({
          children: [
            new TextRun({ text: `해설: ${safeExportText(f.explanation)}`, size: 18, italics: true, color: '6B7280' }),
          ],
          spacing: { after: 200 },
        }),
      );
    }
    return children;
  });

  const docxDoc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new DocxParagraph({
            children: [new TextRun({ text: '회원 변형 문항', bold: true, size: 32 })],
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER,
            spacing: { after: 300 },
          }),
          ...sections.flat(),
        ],
      },
    ],
  });

  const buf = await Packer.toBuffer(docxDoc);
  return Buffer.from(buf);
}

export async function buildMemberVariantPdfBuffer(docs: MemberVariantExportDoc[]): Promise<Buffer> {
  const fontBuf = await getKoreanFontBuffer();
  const pdfDoc = new PDFDocument({ size: 'A4', margins: { top: 50, bottom: 50, left: 50, right: 50 } });
  pdfDoc.registerFont('Korean', fontBuf);
  pdfDoc.font('Korean');

  const chunks: Buffer[] = [];
  pdfDoc.on('data', (c: Buffer) => chunks.push(c));

  pdfDoc.fontSize(18).text('회원 변형 문항', { align: 'center' });
  pdfDoc.moveDown(1);

  for (let i = 0; i < docs.length; i++) {
    const d = docs[i];
    const f = flattenMemberQuestionData(d.question_data ?? {});
    if (i > 0) pdfDoc.moveDown(0.5);
    if (pdfDoc.y > 700) pdfDoc.addPage();

    pdfDoc
      .fontSize(11)
      .text(
        `${i + 1}. [${safeExportText(str(d.type))}] (${safeExportText(str(d.difficulty))}) · ${safeExportText(str(d.textbook))}`,
        { continued: false },
      );
    if (f.question) {
      pdfDoc.fontSize(10).text(`발문: ${safeExportText(f.question)}`, { lineGap: 3 });
    }
    if (f.paragraph) {
      pdfDoc.fontSize(10).text(safeExportText(f.paragraph), { lineGap: 3 });
    }
    if (f.optionsDisplay) {
      pdfDoc.moveDown(0.3);
      for (const line of safeExportText(f.optionsDisplay).split(/\n/).filter(Boolean)) {
        pdfDoc.text(line);
      }
    }
    pdfDoc.moveDown(0.3);
    pdfDoc.fillColor('#2563EB').text(`정답: ${safeExportText(f.answer)}`, { continued: false });
    pdfDoc.fillColor('#000000');
    if (f.explanation) {
      pdfDoc.fontSize(9).fillColor('#6B7280').text(`해설: ${safeExportText(f.explanation)}`);
      pdfDoc.fillColor('#000000').fontSize(10);
    }
    pdfDoc.moveDown(0.5);
    pdfDoc.strokeColor('#E5E7EB').lineWidth(0.5).moveTo(50, pdfDoc.y).lineTo(545, pdfDoc.y).stroke();
  }

  pdfDoc.end();
  return await new Promise<Buffer>((resolve) => pdfDoc.on('end', () => resolve(Buffer.concat(chunks))));
}
