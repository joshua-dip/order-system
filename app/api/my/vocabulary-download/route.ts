import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import * as XLSX from 'xlsx';
import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { isAnnualMemberActive } from '@/lib/annual-member';
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
  format: 'xlsx' | 'pdf' | 'test-xlsx';
  testDirection: 'word-to-meaning' | 'meaning-to-word';
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
        return { textbook, chapter: parts[0], number: parts.slice(1).join(' ') };
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

/* ── 단어시험지 xlsx ── */

function buildTestXlsx(
  passages: { _id: unknown; chapter?: string; number?: string }[],
  vocabByFile: Map<string, VocabularyEntry[]>,
  cefrLevels: string[],
  direction: 'word-to-meaning' | 'meaning-to-word',
): Buffer {
  const wb = XLSX.utils.book_new();

  const questionLabel = direction === 'word-to-meaning' ? '영단어' : '뜻';
  const answerLabel = direction === 'word-to-meaning' ? '뜻' : '영단어';

  const testHeaders = ['번호', questionLabel, answerLabel];
  const ansHeaders = ['번호', questionLabel, answerLabel];

  const testRows: (string | number)[][] = [testHeaders];
  const ansRows: (string | number)[][] = [ansHeaders];

  let idx = 0;
  for (const p of passages) {
    const fn = passageAnalysisFileNameForPassageId(String(p._id));
    let list = vocabByFile.get(fn);
    if (!list?.length) continue;
    list = filterByCefr(sortVocabularyEntries(list, 'position'), cefrLevels);
    for (const item of list) {
      if (!item.meaning) continue;
      idx++;
      const question = direction === 'word-to-meaning' ? item.word : item.meaning;
      const answer = direction === 'word-to-meaning' ? item.meaning : item.word;
      testRows.push([idx, question, '']);
      ansRows.push([idx, question, answer]);
    }
  }

  const testWs = XLSX.utils.aoa_to_sheet(testRows);
  testWs['!cols'] = [{ wch: 6 }, { wch: 24 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, testWs, '시험지');

  const ansWs = XLSX.utils.aoa_to_sheet(ansRows);
  ansWs['!cols'] = [{ wch: 6 }, { wch: 24 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, ansWs, '정답지');

  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
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
    const doc = new PDFDocument({ size: 'A4', margin: 36, bufferPages: true });
    doc.registerFont('Korean', fontBuffer);
    doc.font('Korean');

    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(14).text(`단어장 — ${textbook}`, { align: 'center' });
    doc.moveDown(0.5);

    const colDefs: { label: string; width: number; get: (v: VocabularyEntry) => string }[] = [
      { label: '#', width: 24, get: () => '' },
      { label: '단어', width: 80, get: (v) => v.word },
    ];
    if (cols.pos) colDefs.push({ label: '품사', width: 36, get: (v) => v.partOfSpeech || '' });
    if (cols.cefr) colDefs.push({ label: 'CEFR', width: 30, get: (v) => v.cefr || '' });
    if (cols.meaning) colDefs.push({ label: '뜻', width: 140, get: (v) => v.meaning || '' });
    if (cols.synonym) colDefs.push({ label: '동의어', width: 80, get: (v) => v.synonym || '' });
    if (cols.antonym) colDefs.push({ label: '반의어', width: 80, get: (v) => v.antonym || '' });

    const pageWidth = 523;
    const totalDefined = colDefs.reduce((s, c) => s + c.width, 0);
    const scale = pageWidth / totalDefined;
    colDefs.forEach((c) => (c.width = Math.floor(c.width * scale)));

    const rowH = 16;
    const headerH = 18;
    let y = doc.y;

    for (const p of passages) {
      const fn = passageAnalysisFileNameForPassageId(String(p._id));
      let list = vocabByFile.get(fn);
      if (!list?.length) continue;
      list = filterByCefr(sortVocabularyEntries(list, 'position'), cefrLevels);
      if (list.length === 0) continue;

      if (y > 700) { doc.addPage(); y = 36; }
      doc.fontSize(10).text(`${p.chapter ?? ''} ${p.number ?? ''}`, 36, y, { underline: true });
      y += headerH;

      let x = 36;
      doc.fontSize(7).fillColor('#666666');
      for (const col of colDefs) {
        doc.text(col.label, x + 2, y + 2, { width: col.width - 4, lineBreak: false });
        x += col.width;
      }
      doc.fillColor('#000000');
      y += rowH;

      list.forEach((item, idx) => {
        if (y > 780) { doc.addPage(); y = 36; }
        x = 36;
        const row = colDefs.map((col) => col.get(item));
        row[0] = String(idx + 1);
        doc.fontSize(7);
        for (let ci = 0; ci < colDefs.length; ci++) {
          const text = row[ci].slice(0, 50);
          doc.text(text, x + 2, y + 2, { width: colDefs[ci].width - 4, lineBreak: false });
          x += colDefs[ci].width;
        }
        y += rowH;
      });
      y += 8;
    }

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
    { projection: { annualMemberSince: 1 } },
  );
  if (!user || !isAnnualMemberActive((user as { annualMemberSince?: Date }).annualMemberSince ?? null)) {
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
      format: ['xlsx', 'pdf', 'test-xlsx'].includes(body.format) ? body.format : 'xlsx',
      testDirection: body.testDirection === 'meaning-to-word' ? 'meaning-to-word' : 'word-to-meaning',
    };

    if (!params.textbook) return NextResponse.json({ error: '교재명이 필요합니다.' }, { status: 400 });

    const { passages, vocabByFile } = await loadVocabulary(db, params.textbook, params.selectedLessons);
    if (passages.length === 0) return NextResponse.json({ error: '해당 조건의 지문이 없습니다.' }, { status: 404 });

    const suffix = params.selectedLessons.length > 0 ? `_${params.selectedLessons.length}지문` : '_전체';

    if (params.format === 'test-xlsx') {
      const buf = buildTestXlsx(passages, vocabByFile, params.cefrLevels, params.testDirection);
      const fileName = `단어시험지_${params.textbook}${suffix}.xlsx`;
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
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
