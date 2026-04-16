import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import * as XLSX from 'xlsx';
import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { hasAnnualMemberMenuAccess } from '@/lib/premium-member';
import { isMockExamPassageTextbookStored } from '@/lib/member-variant-passage-sources';
import {
  passageAnalysisFileNameForPassageId,
  type PassageStateStored,
  type VocabularyEntry,
} from '@/lib/passage-analyzer-types';
import { sortVocabularyEntries } from '@/lib/passage-analyzer-vocabulary';
import { VOCABULARY_WORD_TYPE_LABELS } from '@/lib/passage-analyzer-vocabulary';

/* ── 요청 파라미터 타입 ── */

interface DownloadParams {
  textbook: string;
  selectedLessons: string[];
  cefrLevels: string[];
  columns: {
    wordType: boolean;
    pos: boolean;
    cefr: boolean;
    meaning: boolean;
    synonym: boolean;
    antonym: boolean;
    opposite: boolean;
  };
  format: 'xlsx' | 'pdf' | 'test-xlsx' | 'test-pdf';
  testDirection: 'word-to-meaning' | 'meaning-to-word';
  testColumns: 1 | 2;
  testShuffle: boolean;
}

const CEFR_ALL = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

/* ── 한글 폰트 캐시 (PDF 용) ── */

let fontCache: Buffer | null = null;

async function getKoreanFont(): Promise<Buffer> {
  if (fontCache) return fontCache;

  const localPath = path.join(process.cwd(), 'lib', 'fonts', 'NanumGothic-Regular.ttf');
  if (fs.existsSync(localPath)) {
    fontCache = fs.readFileSync(localPath);
    return fontCache;
  }

  const urls = [
    'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/nanumgothic/NanumGothic-Regular.ttf',
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 100_000) {
          fontCache = buf;
          return fontCache;
        }
      }
    } catch { /* try next */ }
  }

  throw new Error('한글 폰트를 불러올 수 없습니다.');
}

/* ── 지문 로드 ── */

async function loadVocabulary(
  db: ReturnType<Awaited<ReturnType<typeof getDb>>['collection']> extends never ? never : Awaited<ReturnType<typeof getDb>>,
  textbook: string,
  selectedLessons: string[],
) {
  type PRow = { _id: unknown; textbook?: string; chapter?: string; number?: string; source_key?: string; order?: number };

  let passageFilter: Record<string, unknown>;
  if (selectedLessons.length > 0) {
    passageFilter = {
      $or: selectedLessons.map((l) => {
        const parts = l.split(' ');
        if (parts.length >= 2) {
          return { textbook, chapter: parts[0], number: parts.slice(1).join(' ') };
        }
        return { textbook, number: l };
      }),
    };
  } else {
    passageFilter = { textbook };
  }

  const passages = (await db
    .collection('passages')
    .find(passageFilter)
    .project({ _id: 1, textbook: 1, chapter: 1, number: 1, source_key: 1, order: 1 })
    .sort({ chapter: 1, order: 1, number: 1 })
    .limit(500)
    .toArray()) as PRow[];

  if (passages.length === 0) return { passages: [] as PRow[], vocabByFile: new Map<string, VocabularyEntry[]>() };

  const fileNames = passages.map((p) => passageAnalysisFileNameForPassageId(String(p._id)));
  const analyses = await db
    .collection('passage_analyses')
    .find({ fileName: { $in: fileNames } })
    .project({ fileName: 1, passageStates: 1 })
    .toArray();

  const vocabByFile = new Map<string, VocabularyEntry[]>();
  for (const a of analyses) {
    const fn = String((a as { fileName?: string }).fileName || '');
    const main = (a as { passageStates?: { main?: PassageStateStored } }).passageStates?.main;
    const list = Array.isArray(main?.vocabularyList) ? main!.vocabularyList! : [];
    if (list.length > 0) vocabByFile.set(fn, list);
  }

  return { passages, vocabByFile };
}

/* ── CEFR 필터 ── */

function filterByCefr(list: VocabularyEntry[], levels: string[]): VocabularyEntry[] {
  if (levels.length === 0 || levels.length === 6) return list;
  const set = new Set(levels.map((l) => l.toUpperCase()));
  return list.filter((item) => {
    const c = (item.cefr || '').toUpperCase().trim();
    return !c || set.has(c);
  });
}

/* ── xlsx 단어장 생성 ── */

function buildCustomXlsx(
  passages: { _id: unknown; textbook?: string; chapter?: string; number?: string }[],
  vocabByFile: Map<string, VocabularyEntry[]>,
  cefrLevels: string[],
  cols: DownloadParams['columns'],
): Buffer {
  const headers: string[] = ['회차', '번호', '순번', '단어'];
  if (cols.wordType) headers.push('유형');
  if (cols.pos) headers.push('품사');
  if (cols.cefr) headers.push('CEFR');
  if (cols.meaning) headers.push('뜻');
  if (cols.synonym) headers.push('동의어');
  if (cols.antonym) headers.push('반의어');
  if (cols.opposite) headers.push('유의어');

  const rows: (string | number)[][] = [headers];

  for (const p of passages) {
    const fn = passageAnalysisFileNameForPassageId(String(p._id));
    let list = vocabByFile.get(fn);
    if (!list?.length) continue;
    list = filterByCefr(sortVocabularyEntries(list, 'position'), cefrLevels);
    const ch = String(p.chapter ?? '');
    const num = String(p.number ?? '');

    list.forEach((item, i) => {
      const row: (string | number)[] = [ch, num, i + 1, item.word];
      if (cols.wordType) row.push(VOCABULARY_WORD_TYPE_LABELS[item.wordType || 'word'] ?? (item.wordType || 'word'));
      if (cols.pos) row.push(item.partOfSpeech || '');
      if (cols.cefr) row.push(item.cefr || '');
      if (cols.meaning) row.push(item.meaning || '');
      if (cols.synonym) row.push(item.synonym || '');
      if (cols.antonym) row.push(item.antonym || '');
      if (cols.opposite) row.push(item.opposite || '');
      rows.push(row);
    });
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, '단어장');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

/* ── Fisher-Yates 셔플 ── */

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ── 단어시험지 xlsx ── */

function buildTestXlsx(
  passages: { _id: unknown; chapter?: string; number?: string }[],
  vocabByFile: Map<string, VocabularyEntry[]>,
  cefrLevels: string[],
  direction: 'word-to-meaning' | 'meaning-to-word',
  shuffle = false,
): Buffer {
  const wb = XLSX.utils.book_new();

  const questionLabel = direction === 'word-to-meaning' ? '영단어' : '뜻';
  const answerLabel = direction === 'word-to-meaning' ? '뜻' : '영단어';

  const testHeaders = ['번호', questionLabel, answerLabel];
  const ansHeaders = ['번호', questionLabel, answerLabel];

  const testRows: (string | number)[][] = [testHeaders];
  const ansRows: (string | number)[][] = [ansHeaders];

  let items: { question: string; answer: string }[] = [];
  for (const p of passages) {
    const fn = passageAnalysisFileNameForPassageId(String(p._id));
    let list = vocabByFile.get(fn);
    if (!list?.length) continue;
    list = filterByCefr(sortVocabularyEntries(list, 'position'), cefrLevels);
    for (const item of list) {
      if (!item.meaning) continue;
      items.push({
        question: direction === 'word-to-meaning' ? item.word : item.meaning,
        answer: direction === 'word-to-meaning' ? item.meaning : item.word,
      });
    }
  }

  if (shuffle) items = shuffleArray(items);

  items.forEach((it, idx) => {
    testRows.push([idx + 1, it.question, '']);
    ansRows.push([idx + 1, it.question, it.answer]);
  });

  const testWs = XLSX.utils.aoa_to_sheet(testRows);
  testWs['!cols'] = [{ wch: 6 }, { wch: 24 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, testWs, '시험지');

  const ansWs = XLSX.utils.aoa_to_sheet(ansRows);
  ansWs['!cols'] = [{ wch: 6 }, { wch: 24 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, ansWs, '정답지');

  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

/* ── 단어시험지 PDF ── */

async function buildTestPdf(
  textbook: string,
  passages: { _id: unknown; chapter?: string; number?: string }[],
  vocabByFile: Map<string, VocabularyEntry[]>,
  cefrLevels: string[],
  direction: 'word-to-meaning' | 'meaning-to-word',
  layoutColumns: 1 | 2 = 1,
  shuffle = false,
): Promise<Buffer> {
  const fontBuffer = await getKoreanFont();

  let items: { question: string; answer: string }[] = [];
  for (const p of passages) {
    const fn = passageAnalysisFileNameForPassageId(String(p._id));
    let list = vocabByFile.get(fn);
    if (!list?.length) continue;
    list = filterByCefr(sortVocabularyEntries(list, 'position'), cefrLevels);
    for (const item of list) {
      if (!item.meaning) continue;
      items.push({
        question: direction === 'word-to-meaning' ? item.word : item.meaning,
        answer: direction === 'word-to-meaning' ? item.meaning : item.word,
      });
    }
  }

  if (shuffle) items = shuffleArray(items);

  const questionLabel = direction === 'word-to-meaning' ? '영단어' : '뜻';
  const answerLabel = direction === 'word-to-meaning' ? '뜻' : '영단어';

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 36, bufferPages: true });
    doc.registerFont('Korean', fontBuffer);
    doc.font('Korean');

    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const margin = 36;
    const pageW = 523;
    const rowH = 16;
    const gap = 12;

    const rows = items.map((it, i) => ({ num: i + 1, col1: it.question, col2: it.answer }));

    if (layoutColumns === 2) {
      const halfW = (pageW - gap) / 2;
      const numW = 22;
      const qW = halfW * 0.42 - numW;
      const aW = halfW * 0.58;

      const renderPage2Col = (title: string, allRows: typeof rows, showAnswer: boolean) => {
        doc.fontSize(13).text(`${title} — ${textbook}`, { align: 'center' });
        doc.moveDown(0.3);

        const maxRows = Math.floor((780 - doc.y) / rowH);
        let pageIdx = 0;

        for (let startIdx = 0; startIdx < allRows.length; ) {
          if (pageIdx > 0) { doc.addPage(); }
          const rowsPerPage = pageIdx === 0 ? maxRows : Math.floor((780 - margin) / rowH);
          const leftEnd = Math.min(startIdx + rowsPerPage, allRows.length);
          const rightStart = leftEnd;
          const rightEnd = Math.min(rightStart + rowsPerPage, allRows.length);
          const sliceLeft = allRows.slice(startIdx, leftEnd);
          const sliceRight = allRows.slice(rightStart, rightEnd);

          let y = pageIdx === 0 ? doc.y : margin;

          doc.fontSize(6.5).fillColor('#666666');
          for (let side = 0; side < 2; side++) {
            const baseX = margin + side * (halfW + gap);
            let x = baseX;
            doc.text('#', x + 1, y + 2, { width: numW - 2, lineBreak: false });
            x += numW;
            doc.text(questionLabel, x + 1, y + 2, { width: qW - 2, lineBreak: false });
            x += qW;
            doc.text(answerLabel, x + 1, y + 2, { width: aW - 2, lineBreak: false });
          }
          doc.fillColor('#000000');
          doc.moveTo(margin, y + rowH - 1).lineTo(margin + halfW, y + rowH - 1).lineWidth(0.5).strokeColor('#cccccc').stroke();
          doc.moveTo(margin + halfW + gap, y + rowH - 1).lineTo(margin + pageW, y + rowH - 1).lineWidth(0.5).strokeColor('#cccccc').stroke();
          y += rowH;

          const maxLen = Math.max(sliceLeft.length, sliceRight.length);
          for (let ri = 0; ri < maxLen; ri++) {
            for (let side = 0; side < 2; side++) {
              const row = side === 0 ? sliceLeft[ri] : sliceRight[ri];
              if (!row) continue;
              const baseX = margin + side * (halfW + gap);
              let x = baseX;
              doc.fontSize(7);
              doc.text(String(row.num), x + 1, y + 2, { width: numW - 2, lineBreak: false });
              x += numW;
              doc.text(row.col1.slice(0, 30), x + 1, y + 2, { width: qW - 2, lineBreak: false });
              x += qW;
              if (showAnswer) {
                doc.text(row.col2.slice(0, 30), x + 1, y + 2, { width: aW - 2, lineBreak: false });
              }
            }
            doc.moveTo(margin, y + rowH - 1).lineTo(margin + halfW, y + rowH - 1).lineWidth(0.2).strokeColor('#e0e0e0').stroke();
            doc.moveTo(margin + halfW + gap, y + rowH - 1).lineTo(margin + pageW, y + rowH - 1).lineWidth(0.2).strokeColor('#e0e0e0').stroke();
            y += rowH;
          }

          startIdx = rightEnd > rightStart ? rightEnd : leftEnd;
          pageIdx++;
        }
      };

      renderPage2Col('단어 시험지', rows, false);
      doc.addPage();
      renderPage2Col('정답지', rows, true);
    } else {
      const colW = [30, pageW * 0.38, pageW * 0.62 - 30];

      const renderPage1Col = (title: string, allRows: typeof rows, showAnswer: boolean) => {
        doc.fontSize(13).text(`${title} — ${textbook}`, { align: 'center' });
        doc.moveDown(0.3);

        let y = doc.y;

        doc.fontSize(7.5).fillColor('#666666');
        let x = margin;
        for (const [i, label] of ['번호', questionLabel, answerLabel].entries()) {
          doc.text(label, x + 2, y + 3, { width: colW[i] - 4, lineBreak: false });
          x += colW[i];
        }
        doc.moveTo(margin, y + rowH - 1).lineTo(margin + pageW, y + rowH - 1).lineWidth(0.5).strokeColor('#cccccc').stroke();
        doc.fillColor('#000000');
        y += rowH;

        for (const row of allRows) {
          if (y > 780) { doc.addPage(); y = margin; }
          x = margin;
          doc.fontSize(7.5);
          doc.text(String(row.num), x + 2, y + 3, { width: colW[0] - 4, lineBreak: false });
          x += colW[0];
          doc.text(row.col1, x + 2, y + 3, { width: colW[1] - 4, lineBreak: false });
          x += colW[1];
          if (showAnswer) {
            doc.text(row.col2, x + 2, y + 3, { width: colW[2] - 4, lineBreak: false });
          }
          doc.moveTo(margin, y + rowH - 1).lineTo(margin + pageW, y + rowH - 1).lineWidth(0.3).strokeColor('#e0e0e0').stroke();
          y += rowH;
        }
      };

      renderPage1Col('단어 시험지', rows, false);
      doc.addPage();
      renderPage1Col('정답지', rows, true);
    }

    doc.end();
  });
}

/* ── PDF 단어장 생성 ── */

async function buildPdf(
  textbook: string,
  passages: { _id: unknown; chapter?: string; number?: string }[],
  vocabByFile: Map<string, VocabularyEntry[]>,
  cefrLevels: string[],
  cols: DownloadParams['columns'],
): Promise<Buffer> {
  const fontBuffer = await getKoreanFont();

  return new Promise((resolve, reject) => {
    const margin = 40;
    const doc = new PDFDocument({ size: 'A4', margin, bufferPages: true });
    doc.registerFont('Korean', fontBuffer);
    doc.font('Korean');

    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageW = 595.28 - margin * 2;
    const bottomLimit = 800;

    const brandColor = '#1e40af';
    const brandLight = '#dbeafe';
    const headerBg = '#1e293b';
    const headerText = '#ffffff';
    const zebraLight = '#f8fafc';
    const borderColor = '#e2e8f0';
    const sectionBg = '#eff6ff';
    const sectionBorder = '#3b82f6';
    const mutedText = '#64748b';

    const colDefs: { label: string; width: number; align: 'left' | 'center'; get: (v: VocabularyEntry) => string }[] = [
      { label: '#', width: 26, align: 'center', get: () => '' },
      { label: '단어', width: 90, align: 'left', get: (v) => v.word },
    ];
    if (cols.pos) colDefs.push({ label: '품사', width: 36, align: 'center', get: (v) => v.partOfSpeech || '' });
    if (cols.cefr) colDefs.push({ label: 'CEFR', width: 32, align: 'center', get: (v) => v.cefr || '' });
    if (cols.meaning) colDefs.push({ label: '뜻', width: 140, align: 'left', get: (v) => v.meaning || '' });
    if (cols.synonym) colDefs.push({ label: '동의어', width: 76, align: 'left', get: (v) => v.synonym || '' });
    if (cols.antonym) colDefs.push({ label: '반의어', width: 76, align: 'left', get: (v) => v.antonym || '' });

    const totalDefined = colDefs.reduce((s, c) => s + c.width, 0);
    const scale = pageW / totalDefined;
    colDefs.forEach((c) => (c.width = Math.round(c.width * scale)));
    const diff = pageW - colDefs.reduce((s, c) => s + c.width, 0);
    colDefs[colDefs.length - 1].width += diff;

    const rowH = 18;
    const sectionH = 24;
    const cellPad = 4;

    const drawTitle = () => {
      doc.save();
      doc.rect(margin, margin, pageW, 36).fill(brandColor);
      doc.fontSize(14).fillColor('#ffffff');
      doc.text(textbook, margin, margin + 10, { width: pageW, align: 'center', lineBreak: false });
      doc.restore();
      doc.fillColor('#000000');
      doc.rect(margin, margin + 36, pageW, 2).fill(brandLight);
      return margin + 48;
    };

    const drawTableHeader = (y: number) => {
      doc.save();
      doc.rect(margin, y, pageW, rowH + 2).fill(headerBg);
      let x = margin;
      doc.fontSize(7.5).fillColor(headerText);
      for (const col of colDefs) {
        const tx = col.align === 'center' ? x + col.width / 2 : x + cellPad;
        const opts: PDFKit.Mixins.TextOptions = {
          width: col.width - cellPad * 2,
          lineBreak: false,
          align: col.align,
        };
        doc.text(col.label, col.align === 'center' ? tx - (col.width - cellPad * 2) / 2 : tx, y + 5, opts);
        x += col.width;
      }
      doc.restore();
      doc.fillColor('#000000');
      return y + rowH + 2;
    };

    const drawSectionHeader = (y: number, label: string) => {
      doc.save();
      doc.rect(margin, y, 3, sectionH).fill(sectionBorder);
      doc.rect(margin + 3, y, pageW - 3, sectionH).fill(sectionBg);
      doc.fontSize(9).fillColor('#1e40af');
      doc.text(label, margin + 10, y + 7, { width: pageW - 14, lineBreak: false });
      doc.restore();
      doc.fillColor('#000000');
      return y + sectionH + 2;
    };

    const drawRow = (y: number, values: string[], isEven: boolean) => {
      if (isEven) {
        doc.save();
        doc.rect(margin, y, pageW, rowH).fill(zebraLight);
        doc.restore();
      }
      doc.moveTo(margin, y + rowH).lineTo(margin + pageW, y + rowH)
        .lineWidth(0.3).strokeColor(borderColor).stroke();

      let x = margin;
      doc.fontSize(7.5).fillColor('#1e293b');
      for (let ci = 0; ci < colDefs.length; ci++) {
        const col = colDefs[ci];
        const text = values[ci].slice(0, 60);
        const tx = col.align === 'center' ? x + col.width / 2 : x + cellPad;
        const opts: PDFKit.Mixins.TextOptions = {
          width: col.width - cellPad * 2,
          lineBreak: false,
          align: col.align,
        };
        if (ci === 1) doc.fillColor('#0f172a');
        else if (ci === 0) doc.fillColor(mutedText);
        else doc.fillColor('#334155');
        doc.text(text, col.align === 'center' ? tx - (col.width - cellPad * 2) / 2 : tx, y + 5, opts);
        x += col.width;
      }
      doc.fillColor('#000000');
      return y + rowH;
    };

    const addPageFooter = () => {
      const pages = doc.bufferedPageRange();
      for (let i = 0; i < pages.count; i++) {
        doc.switchToPage(i);
        doc.save();
        doc.fontSize(7).fillColor(mutedText);
        doc.text(
          `${i + 1} / ${pages.count}`,
          margin, 820,
          { width: pageW, align: 'center', lineBreak: false },
        );
        doc.text(
          'next-order',
          margin, 820,
          { width: pageW, align: 'right', lineBreak: false },
        );
        doc.restore();
      }
    };

    let y = drawTitle();
    y += 4;

    let isFirstSection = true;

    for (const p of passages) {
      const fn = passageAnalysisFileNameForPassageId(String(p._id));
      let list = vocabByFile.get(fn);
      if (!list?.length) continue;
      list = filterByCefr(sortVocabularyEntries(list, 'position'), cefrLevels);
      if (list.length === 0) continue;

      const sectionLabel = `${p.chapter ?? ''} ${p.number ?? ''}`.trim();
      const neededH = sectionH + rowH + 2 + rowH * Math.min(list.length, 3);

      if (!isFirstSection && y + neededH > bottomLimit) {
        doc.addPage();
        y = margin;
      }
      isFirstSection = false;

      y = drawSectionHeader(y, sectionLabel);
      y = drawTableHeader(y);

      list.forEach((item, idx) => {
        if (y + rowH > bottomLimit) {
          doc.addPage();
          y = margin;
          y = drawTableHeader(y);
        }
        const values = colDefs.map((col) => col.get(item));
        values[0] = String(idx + 1);
        y = drawRow(y, values, idx % 2 === 0);
      });

      doc.moveTo(margin, y).lineTo(margin + pageW, y).lineWidth(0.5).strokeColor(borderColor).stroke();
      y += 14;
    }

    addPageFooter();
    doc.end();
  });
}

/* ── 메인 핸들러 ── */

export async function POST(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: '인증이 만료되었습니다.' }, { status: 401 });

  const db = await getDb('gomijoshua');
  const user = await db.collection('users').findOne(
    { _id: new ObjectId(payload.sub) },
    { projection: { annualMemberSince: 1, signupPremiumTrialUntil: 1 } },
  );
  const since = (user as { annualMemberSince?: Date } | null)?.annualMemberSince;
  const trialUntil = (user as { signupPremiumTrialUntil?: Date } | null)?.signupPremiumTrialUntil;
  if (!user || !hasAnnualMemberMenuAccess({ annualSince: since ?? null, signupPremiumTrialUntil: trialUntil ?? null })) {
    return NextResponse.json({ error: '연회원만 이용할 수 있습니다.' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const params: DownloadParams = {
      textbook: typeof body.textbook === 'string' ? body.textbook.trim() : '',
      selectedLessons: Array.isArray(body.selectedLessons) ? body.selectedLessons : [],
      cefrLevels: Array.isArray(body.cefrLevels) ? body.cefrLevels : CEFR_ALL,
      columns: {
        wordType: body.columns?.wordType !== false,
        pos: body.columns?.pos !== false,
        cefr: body.columns?.cefr !== false,
        meaning: body.columns?.meaning !== false,
        synonym: body.columns?.synonym ?? true,
        antonym: body.columns?.antonym ?? true,
        opposite: body.columns?.opposite ?? false,
      },
      format: ['xlsx', 'pdf', 'test-xlsx', 'test-pdf'].includes(body.format) ? body.format : 'xlsx',
      testDirection: body.testDirection === 'meaning-to-word' ? 'meaning-to-word' : 'word-to-meaning',
      testColumns: body.testColumns === 2 ? 2 : 1,
      testShuffle: body.testShuffle === true,
    };

    if (!params.textbook) return NextResponse.json({ error: '교재명이 필요합니다.' }, { status: 400 });
    if (!isMockExamPassageTextbookStored(params.textbook)) {
      return NextResponse.json({ error: '모의고사 교재만 선택할 수 있습니다.' }, { status: 400 });
    }

    const { passages, vocabByFile } = await loadVocabulary(db, params.textbook, params.selectedLessons);
    if (passages.length === 0) return NextResponse.json({ error: '해당 조건의 지문이 없습니다.' }, { status: 404 });

    const suffix = params.selectedLessons.length > 0 ? `_${params.selectedLessons.length}지문` : '_전체';

    if (params.format === 'test-xlsx') {
      const buf = buildTestXlsx(passages, vocabByFile, params.cefrLevels, params.testDirection, params.testShuffle);
      const fileName = `단어시험지_${params.textbook}${suffix}.xlsx`;
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        },
      });
    }

    if (params.format === 'test-pdf') {
      const buf = await buildTestPdf(params.textbook, passages, vocabByFile, params.cefrLevels, params.testDirection, params.testColumns, params.testShuffle);
      const fileName = `단어시험지_${params.textbook}${suffix}.pdf`;
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        },
      });
    }

    if (params.format === 'pdf') {
      const buf = await buildPdf(params.textbook, passages, vocabByFile, params.cefrLevels, params.columns);
      const fileName = `단어장_${params.textbook}${suffix}.pdf`;
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        },
      });
    }

    const buf = buildCustomXlsx(passages, vocabByFile, params.cefrLevels, params.columns);
    const fileName = `단어장_${params.textbook}${suffix}.xlsx`;
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      },
    });
  } catch (e) {
    console.error('vocabulary-download:', e);
    return NextResponse.json({ error: '다운로드에 실패했습니다.' }, { status: 500 });
  }
}
