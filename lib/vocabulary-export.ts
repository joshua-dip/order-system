/**
 * 단어장 내보내기 빌더 모음
 * - buildVocabXlsx: 단어장 xlsx
 * - buildVocabPdf: 단어장 PDF
 * - buildTestXlsx: 시험지 xlsx
 * - buildTestPdf: 시험지 PDF
 * - buildFirstLetterPdf: 첫 글자 제시 시험지 PDF
 * - buildHiddenMeaningPdf: 뜻 가리기 시험지 PDF
 * - buildFlashcardPdf: 플래시카드 PDF
 * - buildAnkiCsv: Anki/Quizlet 호환 CSV
 */
import * as XLSX from 'xlsx';
import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import type { VocabularyEntry } from './passage-analyzer-types';
import { sortVocabularyEntries } from './passage-analyzer-vocabulary';
import { VOCABULARY_WORD_TYPE_LABELS } from './passage-analyzer-vocabulary';

/* ── 타입 ── */

export interface VocabColumns {
  wordType: boolean;
  pos: boolean;
  cefr: boolean;
  meaning: boolean;
  synonym: boolean;
  antonym: boolean;
  opposite: boolean;
}

export const DEFAULT_COLUMNS: VocabColumns = {
  wordType: true,
  pos: true,
  cefr: true,
  meaning: true,
  synonym: true,
  antonym: true,
  opposite: false,
};

/* ── 한글 폰트 캐시 ── */

let fontCache: Buffer | null = null;

export async function getKoreanFont(): Promise<Buffer> {
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

/* ── CEFR 필터 ── */

export function filterByCefr(list: VocabularyEntry[], levels: string[]): VocabularyEntry[] {
  if (levels.length === 0 || levels.length === 6) return list;
  const set = new Set(levels.map((l) => l.toUpperCase()));
  return list.filter((item) => {
    const c = (item.cefr || '').toUpperCase().trim();
    return !c || set.has(c);
  });
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

/* ── 단어장 xlsx ── */

export function buildVocabXlsx(
  entries: VocabularyEntry[],
  displayLabel: string,
  cefrLevels: string[],
  cols: VocabColumns,
): Buffer {
  const filtered = filterByCefr(sortVocabularyEntries(entries, 'position'), cefrLevels);

  const headers: string[] = ['순번', '단어'];
  if (cols.wordType) headers.push('유형');
  if (cols.pos) headers.push('품사');
  if (cols.cefr) headers.push('CEFR');
  if (cols.meaning) headers.push('뜻');
  if (cols.synonym) headers.push('동의어');
  if (cols.antonym) headers.push('반의어');
  if (cols.opposite) headers.push('유의어');

  const rows: (string | number)[][] = [headers];

  filtered.forEach((item, i) => {
    const row: (string | number)[] = [i + 1, item.word];
    if (cols.wordType) row.push(VOCABULARY_WORD_TYPE_LABELS[item.wordType || 'word'] ?? item.wordType ?? 'word');
    if (cols.pos) row.push(item.partOfSpeech || '');
    if (cols.cefr) row.push(item.cefr || '');
    if (cols.meaning) row.push(item.meaning || '');
    if (cols.synonym) row.push(item.synonym || '');
    if (cols.antonym) row.push(item.antonym || '');
    if (cols.opposite) row.push(item.opposite || '');
    rows.push(row);
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, displayLabel.slice(0, 31));
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

/* ── 시험지 xlsx ── */

export function buildTestXlsx(
  entries: VocabularyEntry[],
  cefrLevels: string[],
  direction: 'word-to-meaning' | 'meaning-to-word',
  shuffle = false,
): Buffer {
  const filtered = filterByCefr(sortVocabularyEntries(entries, 'position'), cefrLevels);

  const questionLabel = direction === 'word-to-meaning' ? '영단어' : '뜻';
  const answerLabel = direction === 'word-to-meaning' ? '뜻' : '영단어';

  let items = filtered
    .filter((e) => e.meaning)
    .map((e) => ({
      question: direction === 'word-to-meaning' ? e.word : e.meaning!,
      answer: direction === 'word-to-meaning' ? e.meaning! : e.word,
    }));

  if (shuffle) items = shuffleArray(items);

  const testRows: (string | number)[][] = [['번호', questionLabel, answerLabel]];
  const ansRows: (string | number)[][] = [['번호', questionLabel, answerLabel]];

  items.forEach((it, idx) => {
    testRows.push([idx + 1, it.question, '']);
    ansRows.push([idx + 1, it.question, it.answer]);
  });

  const wb = XLSX.utils.book_new();
  const testWs = XLSX.utils.aoa_to_sheet(testRows);
  testWs['!cols'] = [{ wch: 6 }, { wch: 24 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, testWs, '시험지');

  const ansWs = XLSX.utils.aoa_to_sheet(ansRows);
  ansWs['!cols'] = [{ wch: 6 }, { wch: 24 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, ansWs, '정답지');

  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

/* ── 단어장 PDF ── */

export async function buildVocabPdf(
  entries: VocabularyEntry[],
  title: string,
  cefrLevels: string[],
  cols: VocabColumns,
): Promise<Buffer> {
  const fontBuffer = await getKoreanFont();
  const filtered = filterByCefr(sortVocabularyEntries(entries, 'position'), cefrLevels);

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
    const mutedText = '#64748b';

    const colDefs: { label: string; width: number; align: 'left' | 'center'; get: (v: VocabularyEntry, i: number) => string }[] = [
      { label: '#', width: 26, align: 'center', get: (_, i) => String(i + 1) },
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
    const cellPad = 4;

    doc.save();
    doc.rect(margin, margin, pageW, 36).fill(brandColor);
    doc.fontSize(14).fillColor('#ffffff');
    doc.text(title, margin, margin + 10, { width: pageW, align: 'center', lineBreak: false });
    doc.restore();
    doc.rect(margin, margin + 36, pageW, 2).fill(brandLight);
    let y = margin + 48;

    // 테이블 헤더
    const drawHeader = (yPos: number) => {
      doc.save();
      doc.rect(margin, yPos, pageW, rowH + 2).fill(headerBg);
      let x = margin;
      doc.fontSize(7.5).fillColor(headerText);
      for (const col of colDefs) {
        const tx = col.align === 'center' ? x + col.width / 2 : x + cellPad;
        doc.text(col.label, col.align === 'center' ? tx - (col.width - cellPad * 2) / 2 : tx, yPos + 5, {
          width: col.width - cellPad * 2,
          lineBreak: false,
          align: col.align,
        });
        x += col.width;
      }
      doc.restore();
      return yPos + rowH + 2;
    };

    y = drawHeader(y);

    filtered.forEach((item, idx) => {
      if (y + rowH > bottomLimit) {
        doc.addPage();
        y = margin;
        y = drawHeader(y);
      }
      if (idx % 2 === 0) {
        doc.save();
        doc.rect(margin, y, pageW, rowH).fill(zebraLight);
        doc.restore();
      }
      doc.moveTo(margin, y + rowH).lineTo(margin + pageW, y + rowH).lineWidth(0.3).strokeColor(borderColor).stroke();

      let x = margin;
      doc.fontSize(7.5);
      colDefs.forEach((col, ci) => {
        const text = col.get(item, idx).slice(0, 60);
        const tx = col.align === 'center' ? x + col.width / 2 : x + cellPad;
        if (ci === 1) doc.fillColor('#0f172a');
        else if (ci === 0) doc.fillColor(mutedText);
        else doc.fillColor('#334155');
        doc.text(text, col.align === 'center' ? tx - (col.width - cellPad * 2) / 2 : tx, y + 5, {
          width: col.width - cellPad * 2,
          lineBreak: false,
          align: col.align,
        });
        x += col.width;
      });
      y += rowH;
    });

    // 페이지 번호
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      doc.save();
      doc.fontSize(7).fillColor(mutedText);
      doc.text(`${i + 1} / ${pages.count}`, margin, 820, { width: pageW, align: 'center', lineBreak: false });
      doc.restore();
    }

    doc.end();
  });
}

/* ── 시험지 PDF (공통 렌더러) ── */

async function renderTestPdf(
  title: string,
  items: { question: string; answer: string }[],
  questionLabel: string,
  answerLabel: string,
  layoutColumns: 1 | 2,
): Promise<Buffer> {
  const fontBuffer = await getKoreanFont();

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

      const renderPage2Col = (pageTitle: string, allRows: typeof rows, showAnswer: boolean) => {
        doc.fontSize(13).text(`${pageTitle} — ${title}`, { align: 'center' });
        doc.moveDown(0.3);
        const maxRows = Math.floor((780 - doc.y) / rowH);
        let pageIdx = 0;

        for (let startIdx = 0; startIdx < allRows.length; ) {
          if (pageIdx > 0) doc.addPage();
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
              if (showAnswer) doc.text(row.col2.slice(0, 30), x + 1, y + 2, { width: aW - 2, lineBreak: false });
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

      const renderPage1Col = (pageTitle: string, allRows: typeof rows, showAnswer: boolean) => {
        doc.fontSize(13).text(`${pageTitle} — ${title}`, { align: 'center' });
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
          if (showAnswer) doc.text(row.col2, x + 2, y + 3, { width: colW[2] - 4, lineBreak: false });
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

export async function buildTestPdf(
  entries: VocabularyEntry[],
  title: string,
  cefrLevels: string[],
  direction: 'word-to-meaning' | 'meaning-to-word',
  layoutColumns: 1 | 2 = 1,
  shuffle = false,
): Promise<Buffer> {
  const filtered = filterByCefr(sortVocabularyEntries(entries, 'position'), cefrLevels);
  let items = filtered
    .filter((e) => e.meaning)
    .map((e) => ({
      question: direction === 'word-to-meaning' ? e.word : e.meaning!,
      answer: direction === 'word-to-meaning' ? e.meaning! : e.word,
    }));
  if (shuffle) items = shuffleArray(items);
  const questionLabel = direction === 'word-to-meaning' ? '영단어' : '뜻';
  const answerLabel = direction === 'word-to-meaning' ? '뜻' : '영단어';
  return renderTestPdf(title, items, questionLabel, answerLabel, layoutColumns);
}

/* ── 첫 글자 제시 시험지 PDF ── */

export async function buildFirstLetterPdf(
  entries: VocabularyEntry[],
  title: string,
  cefrLevels: string[],
  shuffle = false,
): Promise<Buffer> {
  const filtered = filterByCefr(sortVocabularyEntries(entries, 'position'), cefrLevels);
  let items = filtered
    .filter((e) => e.meaning && e.word.length > 0)
    .map((e) => ({
      question: e.meaning!,
      answer: e.word,
      hint: e.word.charAt(0) + '_'.repeat(Math.max(0, e.word.length - 1)),
    }));
  if (shuffle) items = shuffleArray(items);

  const fontBuffer = await getKoreanFont();

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
    const rowH = 18;

    const renderSheet = (pageTitle: string, showAnswer: boolean) => {
      doc.fontSize(13).text(`${pageTitle} — ${title}`, { align: 'center' });
      doc.moveDown(0.3);
      let y = doc.y;

      const colW = [28, pageW * 0.35, pageW * 0.35, pageW * 0.3 - 28];
      doc.fontSize(7).fillColor('#666666');
      let x = margin;
      ['#', '뜻', '첫 글자 힌트', '정답'].forEach((lbl, i) => {
        doc.text(lbl, x + 2, y + 3, { width: colW[i] - 4, lineBreak: false });
        x += colW[i];
      });
      doc.moveTo(margin, y + rowH - 1).lineTo(margin + pageW, y + rowH - 1).lineWidth(0.5).strokeColor('#cccccc').stroke();
      doc.fillColor('#000000');
      y += rowH;

      items.forEach((row, idx) => {
        if (y > 780) { doc.addPage(); y = margin; }
        x = margin;
        doc.fontSize(7.5);
        doc.fillColor('#64748b').text(String(idx + 1), x + 2, y + 3, { width: colW[0] - 4, lineBreak: false });
        x += colW[0];
        doc.fillColor('#334155').text(row.question.slice(0, 40), x + 2, y + 3, { width: colW[1] - 4, lineBreak: false });
        x += colW[1];
        doc.fillColor('#0369a1').text(row.hint, x + 2, y + 3, { width: colW[2] - 4, lineBreak: false });
        x += colW[2];
        if (showAnswer) {
          doc.fillColor('#0f172a').text(row.answer, x + 2, y + 3, { width: colW[3] - 4, lineBreak: false });
        }
        doc.moveTo(margin, y + rowH - 1).lineTo(margin + pageW, y + rowH - 1).lineWidth(0.2).strokeColor('#e0e0e0').stroke();
        y += rowH;
      });
    };

    renderSheet('첫 글자 제시 시험지', false);
    doc.addPage();
    renderSheet('정답지', true);
    doc.end();
  });
}

/* ── 뜻 가리기 시험지 PDF ── */

export async function buildHiddenMeaningPdf(
  entries: VocabularyEntry[],
  title: string,
  cefrLevels: string[],
  shuffle = false,
): Promise<Buffer> {
  const filtered = filterByCefr(sortVocabularyEntries(entries, 'position'), cefrLevels);
  let items = filtered.filter((e) => e.meaning).map((e) => ({ word: e.word, meaning: e.meaning! }));
  if (shuffle) items = shuffleArray(items);

  const fontBuffer = await getKoreanFont();

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
    const rowH = 18;
    const colW = [28, pageW * 0.4, pageW * 0.6 - 28];

    const renderSheet = (pageTitle: string, showMeaning: boolean) => {
      doc.fontSize(13).text(`${pageTitle} — ${title}`, { align: 'center' });
      doc.moveDown(0.3);
      let y = doc.y;

      doc.fontSize(7).fillColor('#666666');
      let x = margin;
      ['#', '영단어', '뜻'].forEach((lbl, i) => {
        doc.text(lbl, x + 2, y + 3, { width: colW[i] - 4, lineBreak: false });
        x += colW[i];
      });
      doc.moveTo(margin, y + rowH - 1).lineTo(margin + pageW, y + rowH - 1).lineWidth(0.5).strokeColor('#cccccc').stroke();
      doc.fillColor('#000000');
      y += rowH;

      items.forEach((row, idx) => {
        if (y > 780) { doc.addPage(); y = margin; }
        x = margin;
        doc.fontSize(7.5);
        doc.fillColor('#64748b').text(String(idx + 1), x + 2, y + 3, { width: colW[0] - 4, lineBreak: false });
        x += colW[0];
        doc.fillColor('#0f172a').text(row.word, x + 2, y + 3, { width: colW[1] - 4, lineBreak: false });
        x += colW[1];
        if (showMeaning) {
          doc.fillColor('#334155').text(row.meaning.slice(0, 50), x + 2, y + 3, { width: colW[2] - 4, lineBreak: false });
        } else {
          doc.fillColor('#e2e8f0').rect(x + 2, y + 3, colW[2] - 8, 10).fill();
        }
        doc.fillColor('#000000');
        doc.moveTo(margin, y + rowH - 1).lineTo(margin + pageW, y + rowH - 1).lineWidth(0.2).strokeColor('#e0e0e0').stroke();
        y += rowH;
      });
    };

    renderSheet('뜻 가리기 시험지', false);
    doc.addPage();
    renderSheet('정답지', true);
    doc.end();
  });
}

/* ── 플래시카드 PDF ── */

export async function buildFlashcardPdf(
  entries: VocabularyEntry[],
  title: string,
  cefrLevels: string[],
): Promise<Buffer> {
  const filtered = filterByCefr(sortVocabularyEntries(entries, 'position'), cefrLevels);
  const fontBuffer = await getKoreanFont();

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 20, bufferPages: true });
    doc.registerFont('Korean', fontBuffer);
    doc.font('Korean');

    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const margin = 20;
    const pageW = 595.28 - margin * 2;
    const cardW = (pageW - 10) / 2;
    const cardH = 100;
    const cols = 2;
    const rows = 4;
    const cardsPerPage = cols * rows;

    for (let i = 0; i < filtered.length; i += cardsPerPage) {
      if (i > 0) doc.addPage();
      const chunk = filtered.slice(i, i + cardsPerPage);

      chunk.forEach((item, idx) => {
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const x = margin + col * (cardW + 10);
        const y = margin + row * (cardH + 8);

        doc.save();
        doc.roundedRect(x, y, cardW, cardH, 8).fill('#f8fafc');
        doc.roundedRect(x, y, cardW, cardH, 8).lineWidth(1).strokeColor('#e2e8f0').stroke();

        doc.fontSize(14).fillColor('#0f172a');
        doc.text(item.word, x + 8, y + 16, { width: cardW - 16, align: 'center', lineBreak: false });

        if (item.partOfSpeech) {
          doc.fontSize(7).fillColor('#64748b');
          doc.text(item.partOfSpeech, x + 8, y + 34, { width: cardW - 16, align: 'center', lineBreak: false });
        }

        if (item.cefr) {
          doc.save();
          doc.roundedRect(x + cardW - 36, y + 6, 28, 14, 4).fill('#dbeafe');
          doc.fontSize(7).fillColor('#1e40af');
          doc.text(item.cefr, x + cardW - 36, y + 10, { width: 28, align: 'center', lineBreak: false });
          doc.restore();
        }

        doc.moveTo(x + 12, y + 46).lineTo(x + cardW - 12, y + 46).lineWidth(0.5).strokeColor('#cbd5e1').stroke();

        doc.fontSize(9).fillColor('#334155');
        doc.text((item.meaning || '').slice(0, 50), x + 8, y + 54, { width: cardW - 16, align: 'center', lineBreak: false });

        if (item.synonym) {
          doc.fontSize(7).fillColor('#64748b');
          doc.text(`≈ ${item.synonym.slice(0, 30)}`, x + 8, y + 72, { width: cardW - 16, align: 'center', lineBreak: false });
        }

        doc.fontSize(7).fillColor('#94a3b8');
        doc.text(`${title}  #${i + idx + 1}`, x + 8, y + cardH - 14, { width: cardW - 16, align: 'right', lineBreak: false });

        doc.restore();
      });
    }

    doc.end();
  });
}

/* ── Anki/Quizlet CSV ── */

export function buildAnkiCsv(
  entries: VocabularyEntry[],
  cefrLevels: string[],
): Buffer {
  const filtered = filterByCefr(sortVocabularyEntries(entries, 'position'), cefrLevels);

  const lines: string[] = ['#separator:tab', '#html:false'];
  for (const e of filtered) {
    const front = e.word;
    const backParts: string[] = [];
    if (e.meaning) backParts.push(e.meaning);
    if (e.partOfSpeech) backParts.push(`[${e.partOfSpeech}]`);
    if (e.cefr) backParts.push(`CEFR: ${e.cefr}`);
    if (e.synonym) backParts.push(`≈ ${e.synonym}`);
    if (e.antonym) backParts.push(`↔ ${e.antonym}`);
    const back = backParts.join(' / ');
    lines.push(`${front}\t${back}`);
  }

  return Buffer.from(lines.join('\n'), 'utf-8');
}
