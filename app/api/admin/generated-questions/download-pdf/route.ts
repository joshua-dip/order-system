import { NextRequest, NextResponse } from 'next/server';
import PDFDocument from 'pdfkit';
import {
  Document,
  Packer,
  Paragraph as DocxParagraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  TabStopPosition,
  TabStopType,
} from 'docx';
import path from 'path';
import fs from 'fs';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';

/* ── font ── */

let fontCache: Buffer | null = null;

async function getKoreanFont(): Promise<Buffer> {
  if (fontCache) return fontCache;
  const localPath = path.join(process.cwd(), 'lib', 'fonts', 'NanumGothic-Regular.ttf');
  if (fs.existsSync(localPath)) {
    fontCache = fs.readFileSync(localPath);
    return fontCache;
  }
  const url =
    'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/nanumgothic/NanumGothic-Regular.ttf';
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

/* ── helpers ── */

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, '');
}

const CIRCLED: Record<string, string> = {
  '①': '(1)',
  '②': '(2)',
  '③': '(3)',
  '④': '(4)',
  '⑤': '(5)',
};

function replaceCircledForPdf(s: string): string {
  return s.replace(/[①②③④⑤]/g, (m) => ` ${CIRCLED[m] ?? m} `);
}

function parseOptions(raw: string): string[] {
  if (raw.includes('###')) return raw.split('###').map((o) => o.trim());
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

/* ── shared query ── */

interface QDoc {
  source?: string;
  type?: string;
  difficulty?: string;
  question_data?: Record<string, unknown>;
}

async function queryDocs(sp: URLSearchParams) {
  const textbook = sp.get('textbook')?.trim() || '';
  const type = sp.get('type')?.trim() || '';
  const difficulty = sp.get('difficulty')?.trim() || '';
  const status = sp.get('status')?.trim() || '';
  const passageId = sp.get('passage_id')?.trim() || '';

  const filter: Record<string, unknown> = {};
  if (textbook) filter.textbook = textbook;
  if (type) filter.type = type;
  if (difficulty) filter.difficulty = difficulty;
  if (status) filter.status = status;
  if (passageId) filter.passage_id = passageId;

  const db = await getDb('gomijoshua');
  const docs = await db
    .collection('generated_questions')
    .find(filter)
    .sort({ textbook: 1, source: 1, type: 1, 'question_data.순서': 1 })
    .limit(500)
    .toArray();

  const filterDesc = [
    textbook || '전체 교재',
    type ? `유형: ${type}` : '',
    difficulty ? `난이도: ${difficulty}` : '',
    status ? `상태: ${status}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return { docs: docs as unknown as QDoc[], filterDesc, textbook };
}

function extractFields(d: QDoc) {
  const qd = d.question_data ?? {};
  return {
    question: String(qd.Question ?? qd.question ?? ''),
    paragraphRaw: String(qd.Paragraph ?? qd.paragraph ?? ''),
    optionsRaw: String(qd.Options ?? qd.options ?? ''),
    correctAnswer: String(qd.CorrectAnswer ?? qd.correctAnswer ?? ''),
    explanation: String(qd.Explanation ?? qd.explanation ?? ''),
    source: String(d.source ?? ''),
    qType: String(d.type ?? ''),
    qDiff: String(d.difficulty ?? '중'),
  };
}

/* ================================================================
 * PDF 생성
 * ================================================================ */

async function buildPdf(
  docs: QDoc[],
  filterDesc: string,
  includeAnswer: boolean,
): Promise<Buffer> {
  const fontBuffer = await getKoreanFont();

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
    doc.registerFont('Korean', fontBuffer);
    doc.font('Korean');

    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const margin = 40;
    const pageW = 595.28 - margin * 2;
    const bottomLimit = 780;

    doc.fontSize(16).text('변형문제 모음', { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(9).fillColor('#666').text(filterDesc, { align: 'center' });
    doc.fontSize(9).text(`총 ${docs.length}문항`, { align: 'center' });
    doc.fillColor('#000');
    doc.moveDown(1);

    for (let qi = 0; qi < docs.length; qi++) {
      const f = extractFields(docs[qi]);

      if (doc.y > bottomLimit - 100) doc.addPage();

      doc
        .fontSize(7)
        .fillColor('#999')
        .text(
          `#${qi + 1}  ${f.source}  [${f.qType}]  난이도: ${f.qDiff}`,
          margin,
          doc.y,
          { width: pageW },
        );
      doc.fillColor('#000').moveDown(0.3);

      doc.fontSize(10).text(f.question, margin, doc.y, { width: pageW });
      doc.moveDown(0.4);

      const paragraph = replaceCircledForPdf(stripHtml(f.paragraphRaw));

      if (paragraph.includes('###')) {
        const [given, ...rest] = paragraph.split('###');
        if (given.trim()) {
          doc.fontSize(9.5).text(given.trim(), margin + 10, doc.y, {
            width: pageW - 20,
            lineGap: 2,
          });
          doc.moveDown(0.3);
        }
        const passageText = rest.join('').trim();
        if (passageText) {
          doc.fontSize(9).text(passageText, margin + 10, doc.y, {
            width: pageW - 20,
            lineGap: 3,
          });
        }
      } else if (paragraph.includes('\n\n')) {
        const parts = paragraph.split('\n\n');
        for (let pi = 0; pi < parts.length; pi++) {
          const pt = parts[pi].trim();
          if (!pt) continue;
          doc.fontSize(pi === 0 ? 9.5 : 9).text(pt, margin + 10, doc.y, {
            width: pageW - 20,
            lineGap: 3,
          });
          if (pi < parts.length - 1) doc.moveDown(0.3);
        }
      } else {
        doc.fontSize(9).text(paragraph, margin + 10, doc.y, {
          width: pageW - 20,
          lineGap: 3,
        });
      }
      doc.moveDown(0.4);

      const opts = parseOptions(replaceCircledForPdf(f.optionsRaw));
      const isCircledOnly = opts.every((o) => /^\(\d\)$/.test(o.trim()));
      if (opts.length > 0 && !isCircledOnly) {
        for (const opt of opts) {
          if (doc.y > bottomLimit) doc.addPage();
          doc.fontSize(9).text(opt, margin + 14, doc.y, { width: pageW - 28 });
          doc.moveDown(0.15);
        }
      }
      doc.moveDown(0.3);

      if (includeAnswer) {
        if (doc.y > bottomLimit - 30) doc.addPage();
        doc
          .fontSize(8.5)
          .fillColor('#1a5276')
          .text(`정답: ${replaceCircledForPdf(f.correctAnswer)}`, margin, doc.y, { width: pageW });
        doc.fillColor('#000');
        if (f.explanation && f.explanation !== 'undefined') {
          doc.moveDown(0.15);
          doc
            .fontSize(7.5)
            .fillColor('#555')
            .text(replaceCircledForPdf(f.explanation), margin + 6, doc.y, {
              width: pageW - 12,
              lineGap: 2,
            });
          doc.fillColor('#000');
        }
      }

      doc.moveDown(0.6);

      if (qi < docs.length - 1) {
        if (doc.y > bottomLimit - 20) {
          doc.addPage();
        } else {
          doc
            .moveTo(margin, doc.y)
            .lineTo(margin + pageW, doc.y)
            .strokeColor('#ddd')
            .lineWidth(0.5)
            .stroke();
          doc.moveDown(0.6);
        }
      }
    }

    doc.end();
  });
}

/* ================================================================
 * DOCX 생성
 * ================================================================ */

function buildDocxParagraphs(docs: QDoc[], filterDesc: string, includeAnswer: boolean) {
  const children: DocxParagraph[] = [];

  children.push(
    new DocxParagraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
      children: [new TextRun({ text: '변형문제 모음', bold: true, size: 32, font: '맑은 고딕' })],
    }),
  );
  children.push(
    new DocxParagraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
      children: [new TextRun({ text: filterDesc, size: 18, color: '666666', font: '맑은 고딕' })],
    }),
  );
  children.push(
    new DocxParagraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 300 },
      children: [
        new TextRun({ text: `총 ${docs.length}문항`, size: 18, color: '666666', font: '맑은 고딕' }),
      ],
    }),
  );

  for (let qi = 0; qi < docs.length; qi++) {
    const f = extractFields(docs[qi]);

    children.push(
      new DocxParagraph({
        spacing: { before: 200, after: 60 },
        border: {
          bottom: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' },
        },
        children: [
          new TextRun({
            text: `#${qi + 1}  ${f.source}  [${f.qType}]  난이도: ${f.qDiff}`,
            size: 14,
            color: '999999',
            font: '맑은 고딕',
          }),
        ],
      }),
    );

    children.push(
      new DocxParagraph({
        spacing: { after: 80 },
        children: [
          new TextRun({ text: f.question, bold: true, size: 20, font: '맑은 고딕' }),
        ],
      }),
    );

    const paragraph = stripHtml(f.paragraphRaw);

    if (paragraph.includes('###')) {
      const [given, ...rest] = paragraph.split('###');
      if (given.trim()) {
        children.push(
          new DocxParagraph({
            indent: { left: 400 },
            spacing: { after: 100 },
            children: [
              new TextRun({ text: given.trim(), bold: true, size: 19, font: '맑은 고딕' }),
            ],
          }),
        );
      }
      const passageText = rest.join('').trim();
      if (passageText) {
        children.push(
          new DocxParagraph({
            indent: { left: 400 },
            spacing: { after: 80, line: 320 },
            children: [new TextRun({ text: passageText, size: 18, font: '맑은 고딕' })],
          }),
        );
      }
    } else if (paragraph.includes('\n\n')) {
      const parts = paragraph.split('\n\n');
      for (const pt of parts) {
        if (!pt.trim()) continue;
        children.push(
          new DocxParagraph({
            indent: { left: 400 },
            spacing: { after: 80, line: 320 },
            children: [new TextRun({ text: pt.trim(), size: 18, font: '맑은 고딕' })],
          }),
        );
      }
    } else {
      children.push(
        new DocxParagraph({
          indent: { left: 400 },
          spacing: { after: 80, line: 320 },
          children: [new TextRun({ text: paragraph, size: 18, font: '맑은 고딕' })],
        }),
      );
    }

    const opts = parseOptions(f.optionsRaw);
    const isCircledOnly = opts.every((o) => /^[①②③④⑤]$/.test(o.trim()));
    if (opts.length > 0 && !isCircledOnly) {
      for (const opt of opts) {
        children.push(
          new DocxParagraph({
            indent: { left: 600 },
            spacing: { after: 30 },
            children: [new TextRun({ text: opt, size: 18, font: '맑은 고딕' })],
          }),
        );
      }
    }

    if (includeAnswer) {
      children.push(
        new DocxParagraph({
          spacing: { before: 80, after: 20 },
          children: [
            new TextRun({
              text: `정답: ${f.correctAnswer}`,
              bold: true,
              size: 17,
              color: '1A5276',
              font: '맑은 고딕',
            }),
          ],
        }),
      );
      if (f.explanation && f.explanation !== 'undefined') {
        children.push(
          new DocxParagraph({
            indent: { left: 200 },
            spacing: { after: 100, line: 280 },
            children: [
              new TextRun({
                text: f.explanation,
                size: 15,
                color: '555555',
                font: '맑은 고딕',
              }),
            ],
          }),
        );
      }
    }
  }

  return children;
}

async function buildDocx(docs: QDoc[], filterDesc: string, includeAnswer: boolean) {
  const docxDoc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: { top: 720, bottom: 720, left: 720, right: 720 },
          },
        },
        children: buildDocxParagraphs(docs, filterDesc, includeAnswer),
      },
    ],
  });

  return Packer.toBuffer(docxDoc);
}

/* ================================================================
 * Route handler
 * ================================================================ */

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const sp = request.nextUrl.searchParams;
  const format = sp.get('format')?.trim().toLowerCase() === 'docx' ? 'docx' : 'pdf';
  const includeAnswer = sp.get('answer') !== '0';

  const { docs, filterDesc, textbook } = await queryDocs(sp);

  if (docs.length === 0) {
    return NextResponse.json({ error: '조건에 맞는 문제가 없습니다.' }, { status: 404 });
  }

  const safeName = (textbook || '전체').replace(/[^\w가-힣()-]/g, '_');

  if (format === 'docx') {
    const buf = await buildDocx(docs, filterDesc, includeAnswer);
    const filename = `변형문제_${safeName}.docx`;
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    });
  }

  const buf = await buildPdf(docs, filterDesc, includeAnswer);
  const filename = `변형문제_${safeName}.pdf`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
