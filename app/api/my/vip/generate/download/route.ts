import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import PDFDocument from 'pdfkit';
import {
  Document, Packer,
  Paragraph as DocxParagraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, WidthType, BorderStyle,
} from 'docx';
import path from 'path';
import fs from 'fs';
import { requireVip } from '@/lib/vip-auth';
import { getDb } from '@/lib/mongodb';

/* ── 폰트 로더 ── */
let fontCache: Record<string, Buffer> = {};
async function loadFont(variant: 'Regular' | 'Bold' = 'Regular'): Promise<Buffer> {
  if (fontCache[variant]) return fontCache[variant];
  const name = `NanumGothic-${variant}.ttf`;
  const local = path.join(process.cwd(), 'lib', 'fonts', name);
  if (fs.existsSync(local)) { fontCache[variant] = fs.readFileSync(local); return fontCache[variant]; }
  const url = `https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/nanumgothic/${name}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (res.ok) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 100_000) { fontCache[variant] = buf; return buf; }
  }
  if (variant === 'Bold') return loadFont('Regular'); // bold 없으면 regular 대체
  throw new Error('한글 폰트를 불러올 수 없습니다.');
}

/* ── 텍스트 정제 ── */
function clean(s: string): string {
  return String(s ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/^#{1,6}\s*/gm, '')   // markdown 헤더 제거
    .replace(/\*\*(.*?)\*\*/g, '$1') // bold 마커 제거
    .replace(/\*(.*?)\*/g, '$1')     // italic 마커 제거
    .replace(/\n{3,}/g, '\n\n')      // 연속 빈줄 압축
    .trim();
}

interface QDoc { type: string; difficulty: string; question_data: { Paragraph?: string; Options?: string; Answer?: string; Explanation?: string } }

export async function GET(request: NextRequest) {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;

  const sp = request.nextUrl.searchParams;
  const format = sp.get('format') === 'docx' ? 'docx' : 'pdf';
  const ids = (sp.get('ids') || '').split(',').filter(Boolean);
  const title = (sp.get('title') || '변형문제').slice(0, 80);
  if (ids.length === 0) return NextResponse.json({ error: '문제 ID가 없습니다.' }, { status: 400 });

  const db = await getDb('gomijoshua');
  const rawDocs = await db.collection('generated_questions')
    .find({ _id: { $in: ids.map((id) => new ObjectId(id)) }, status: '완료' })
    .toArray();

  const idIndex = new Map(ids.map((id, i) => [id, i]));
  const docs: QDoc[] = rawDocs
    .sort((a, b) => (idIndex.get(a._id.toString()) ?? 0) - (idIndex.get(b._id.toString()) ?? 0))
    .map((d) => ({ type: d.type as string, difficulty: d.difficulty as string, question_data: (d.question_data as QDoc['question_data']) ?? {} }));

  if (docs.length === 0) return NextResponse.json({ error: '문제를 찾을 수 없습니다.' }, { status: 404 });

  /* ─────────────────── DOCX ─────────────────── */
  if (format === 'docx') {
    const children: (DocxParagraph | Table)[] = [
      new DocxParagraph({ children: [new TextRun({ text: title, bold: true, size: 36 })], heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER, spacing: { after: 400 } }),
    ];
    const answers: { num: number; answer: string }[] = [];

    docs.forEach((doc, idx) => {
      const qd = doc.question_data;
      const num = idx + 1;
      answers.push({ num, answer: clean(qd.Answer || '') });
      children.push(
        new DocxParagraph({ children: [new TextRun({ text: `${num}.  [${doc.type}]`, bold: true, size: 22 })], spacing: { before: 240, after: 80 } }),
        new DocxParagraph({ children: [new TextRun({ text: clean(qd.Paragraph || ''), size: 20 })], spacing: { after: 80 } }),
      );
      if (qd.Options) {
        for (const line of clean(qd.Options).split(/\n/).filter(Boolean)) {
          children.push(new DocxParagraph({ children: [new TextRun({ text: line, size: 20 })], spacing: { after: 30 } }));
        }
      }
      children.push(new DocxParagraph({ children: [], spacing: { after: 120 } }));
    });

    // 답안지
    children.push(
      new DocxParagraph({ pageBreakBefore: true, children: [] }),
      new DocxParagraph({ children: [new TextRun({ text: '답 안 지', bold: true, size: 32 })], heading: HeadingLevel.HEADING_2, alignment: AlignmentType.CENTER, spacing: { after: 300 } }),
    );
    const COLS = 4;
    const rows: TableRow[] = [
      new TableRow({ children: Array.from({ length: COLS }, () => new TableCell({ children: [new DocxParagraph({ children: [new TextRun({ text: '번호  /  정답', bold: true, size: 18 })], alignment: AlignmentType.CENTER })], width: { size: 25, type: WidthType.PERCENTAGE }, borders: { bottom: { style: BorderStyle.SINGLE, size: 4, color: '000000' } } })) }),
    ];
    for (let r = 0; r < Math.ceil(answers.length / COLS); r++) {
      rows.push(new TableRow({ children: Array.from({ length: COLS }, (_, c) => { const a = answers[r * COLS + c]; return new TableCell({ children: [new DocxParagraph({ children: a ? [new TextRun({ text: `${a.num}.  `, bold: true, size: 20 }), new TextRun({ text: a.answer, size: 20 })] : [new TextRun({ text: '' })], alignment: AlignmentType.CENTER })], width: { size: 25, type: WidthType.PERCENTAGE } }); }) }));
    }
    children.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }));

    const buf = await Packer.toBuffer(new Document({ sections: [{ properties: {}, children }] }));
    return new NextResponse(new Uint8Array(buf), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Content-Disposition': `attachment; filename="${encodeURIComponent(title)}.docx"` } });
  }

  /* ─────────────────── PDF (2단 시험지) ─────────────────── */
  const [regularFont, boldFont] = await Promise.all([loadFont('Regular'), loadFont('Bold')]);

  // A4 치수
  const PAGE_W = 595.28;
  const PAGE_H = 841.89;
  const ML = 40; const MR = 40; const MT = 50; const MB = 50;
  const COL_GAP = 16;
  const FULL_W = PAGE_W - ML - MR;
  const COL_W = (FULL_W - COL_GAP) / 2;
  const COL_X = [ML, ML + COL_W + COL_GAP];
  const COL_BOTTOM = PAGE_H - MB;
  const HEADER_BOTTOM = MT + 56; // 헤더 영역 끝

  const pdfDoc = new PDFDocument({ size: 'A4', margins: { top: MT, bottom: MB, left: ML, right: MR }, autoFirstPage: true, bufferPages: true });
  pdfDoc.registerFont('R', regularFont);
  pdfDoc.registerFont('B', boldFont);

  const chunks: Buffer[] = [];
  pdfDoc.on('data', (c: Buffer) => chunks.push(c));

  // ── 상태
  let col = 0;
  let y = HEADER_BOTTOM;

  const switchCol = () => {
    col++;
    y = HEADER_BOTTOM;
    if (col >= 2) {
      pdfDoc.addPage();
      col = 0;
      y = HEADER_BOTTOM;
      drawPageHeader();
    }
  };

  const ensure = (need: number) => { if (y + need > COL_BOTTOM) switchCol(); };

  // ── 텍스트 높이 추정
  const lineH = (fs: number) => fs * 1.45;
  const estLines = (text: string, width: number, fs: number): number => {
    if (!text) return 0;
    const avgChar = fs * 0.58; // 한글/영문 혼합 평균
    const lines = text.split('\n');
    return lines.reduce((s, l) => s + Math.max(1, Math.ceil((l.length * avgChar) / width)), 0);
  };
  const estHeight = (text: string, width: number, fs: number, gap = 0): number =>
    estLines(text, width, fs) * lineH(fs) + gap;

  // ── 헤더 그리기 (1페이지 + 매 새 페이지)
  const drawPageHeader = () => {
    pdfDoc.font('B').fontSize(13).fillColor('#111827')
      .text(title, ML, MT, { width: FULL_W, align: 'center' });
    pdfDoc.moveTo(ML, MT + 18).lineTo(ML + FULL_W, MT + 18).strokeColor('#374151').lineWidth(1.2).stroke();
    // 이름/반 칸
    pdfDoc.font('R').fontSize(8).fillColor('#6B7280')
      .text('이름 :                학반 :                번호 :       ', ML, MT + 22, { width: FULL_W, align: 'right' });
    pdfDoc.moveTo(ML, MT + 40).lineTo(ML + FULL_W, MT + 40).strokeColor('#D1D5DB').lineWidth(0.5).stroke();
    // 세로 구분선
    const divX = ML + COL_W + COL_GAP / 2;
    pdfDoc.moveTo(divX, HEADER_BOTTOM + 2).lineTo(divX, COL_BOTTOM - 4).strokeColor('#E5E7EB').lineWidth(0.5).stroke();
  };

  drawPageHeader();

  const answers: { num: number; answer: string }[] = [];

  /* ── cx는 ensure() 이후 항상 재계산 (col이 바뀔 수 있음) ── */
  const cx = () => COL_X[col];

  // ── 문제 렌더
  for (let i = 0; i < docs.length; i++) {
    const qd = docs[i].question_data;
    const num = i + 1;
    answers.push({ num, answer: clean(qd.Answer || '') });

    const para = clean(qd.Paragraph || '');
    const opts = qd.Options ? clean(qd.Options).split(/\n/).filter(Boolean) : [];

    /* 전체 높이 추정 → 문제 단위로 칼럼 전환 */
    const numH = lineH(11) + 3;
    const paraH = para ? estHeight(para, COL_W - 10, 9.5, 5) : 0;
    const optsH = opts.reduce((s, l) => s + estHeight(l, COL_W - 18, 9.5, 2.5), 0);
    const totalEst = numH + paraH + optsH + 14;

    ensure(Math.min(totalEst, COL_BOTTOM - HEADER_BOTTOM - 10)); // 너무 크면 부분 허용

    /* ── 번호 ── */
    pdfDoc.font('B').fontSize(11).fillColor('#111827')
      .text(`${num}.`, cx(), y, { width: 26, lineBreak: false });
    y += lineH(11) + 3;

    /* ── 지문 ── */
    if (para) {
      pdfDoc.font('R').fontSize(9.5).fillColor('#111827');
      const lineGap = 1.8;
      const lines = para.split('\n');
      for (const line of lines) {
        if (!line.trim()) { y += lineH(9.5) * 0.4; continue; }
        const lh = pdfDoc.heightOfString(line, { width: COL_W - 10, lineGap });
        ensure(lh);
        pdfDoc.text(line, cx() + 8, y, { width: COL_W - 10, lineGap, align: 'left' });
        y += lh + 1;
      }
      y += 4;
    }

    /* ── 선지 ── */
    if (opts.length > 0) {
      pdfDoc.font('R').fontSize(9.5).fillColor('#111827');
      for (const line of opts) {
        const lh = pdfDoc.heightOfString(line, { width: COL_W - 18, lineGap: 1 });
        ensure(lh + 2);
        pdfDoc.text(line, cx() + 14, y, { width: COL_W - 16, lineGap: 1 });
        y += lh + 2.5;
      }
    }

    /* ── 구분 ── */
    y += 5;
    if (i < docs.length - 1) {
      if (y + 2 <= COL_BOTTOM) {
        pdfDoc.moveTo(cx() + 2, y).lineTo(cx() + COL_W - 2, y)
          .strokeColor('#E5E7EB').lineWidth(0.35).stroke();
      }
      y += 8;
    }
  }

  /* ── 답안지 페이지 ── */
  pdfDoc.addPage();

  const aY = { v: MT };
  const aFullW = FULL_W;

  pdfDoc.font('B').fontSize(13).fillColor('#111827').text('답  안  지', ML, aY.v, { width: aFullW, align: 'center' });
  aY.v += lineH(13) + 4;
  pdfDoc.moveTo(ML, aY.v).lineTo(ML + aFullW, aY.v).strokeColor('#374151').lineWidth(1.2).stroke();
  aY.v += 12;

  // 5열 표
  const ANS_COLS = 5;
  const cellW = aFullW / ANS_COLS;
  const hdrH = 20;
  const rowH = 22;

  // 헤더
  for (let c = 0; c < ANS_COLS; c++) {
    const cx2 = ML + c * cellW;
    pdfDoc.rect(cx2, aY.v, cellW, hdrH).fillAndStroke('#F3F4F6', '#9CA3AF');
    pdfDoc.font('B').fontSize(8).fillColor('#374151')
      .text('번호  /  정답', cx2 + 2, aY.v + 6, { width: cellW - 4, align: 'center' });
  }
  aY.v += hdrH;

  // 답안
  const ansRows = Math.ceil(answers.length / ANS_COLS);
  for (let r = 0; r < ansRows; r++) {
    for (let c = 0; c < ANS_COLS; c++) {
      const a = answers[r * ANS_COLS + c];
      const cx2 = ML + c * cellW;
      pdfDoc.rect(cx2, aY.v, cellW, rowH).stroke('#D1D5DB');
      if (a) {
        pdfDoc.font('B').fontSize(9).fillColor('#111827')
          .text(`${a.num}.`, cx2 + 8, aY.v + 6, { continued: true, width: 18 });
        pdfDoc.font('R').fontSize(9).fillColor('#1D4ED8')
          .text(`  ${a.answer}`, { continued: false });
        pdfDoc.fillColor('#111827');
      }
    }
    aY.v += rowH;
  }

  pdfDoc.end();
  const pdfBuf = await new Promise<Buffer>((resolve) => pdfDoc.on('end', () => resolve(Buffer.concat(chunks))));

  return new NextResponse(new Uint8Array(pdfBuf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(title)}.pdf"`,
    },
  });
}
