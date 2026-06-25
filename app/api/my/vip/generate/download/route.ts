import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import {
  Document, Packer,
  Paragraph as DocxParagraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, WidthType, BorderStyle,
} from 'docx';
import path from 'path';
import fs from 'fs';
import { requireVip } from '@/lib/vip-auth';
import { getDb } from '@/lib/mongodb';
import { formatGeneratedSerial } from '@/lib/generated-question-serial';

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

/** 원형숫자(①②③④⑤) 폴백 폰트 — NanumGothic 에 해당 글리프가 없어 별도 임베드. */
let circledFontCache: Buffer | null | undefined;
function loadCircledFont(): Buffer | null {
  if (circledFontCache !== undefined) return circledFontCache;
  const local = path.join(process.cwd(), 'lib', 'fonts', 'CircledFallback-subset.ttf');
  circledFontCache = fs.existsSync(local) ? fs.readFileSync(local) : null;
  return circledFontCache;
}

const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];

/** Options → 선지 텍스트 배열. 문자열(`###`·│·줄바꿈)·배열·객체 모두 처리, 기존 원형숫자 prefix 제거. */
function normalizeChoices(rawOptions: unknown): string[] {
  let parts: string[];
  if (Array.isArray(rawOptions)) {
    parts = rawOptions.map((p) => clean(String(p ?? '')));
  } else if (rawOptions && typeof rawOptions === 'object') {
    parts = Object.values(rawOptions as Record<string, unknown>).map((p) => clean(String(p ?? '')));
  } else {
    const cleaned = clean(String(rawOptions ?? ''));
    if (!cleaned) return [];
    parts = /###|｜|│/.test(cleaned)
      ? cleaned.split(/\s*(?:###|｜|│)\s*/)
      : cleaned.split(/\n/);
  }
  const stripped = parts.map((p) => p.replace(/^\s*[①②③④⑤⑥⑦⑧⑨⑩]\s*/, '').trim());
  const nonEmpty = stripped.filter((c) => c !== '');
  // 모두 비면(삽입형: 본문에 ①②③④⑤ 표기) 원형숫자만 5개 표기
  if (nonEmpty.length === 0) return ['', '', '', '', ''];
  return nonEmpty;
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

/** clean 과 동일하되 `<u>…</u>` 밑줄 태그는 보존 (어법·어휘·함의 유형 밑줄 렌더용). */
function cleanKeepU(s: string): string {
  return String(s ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<(?!\/?u>)[^>]*>/gi, '') // <u>·</u> 만 남기고 나머지 태그 제거
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** HTML(밑줄 포함) → DOCX TextRun[] (밑줄 구간만 underline). Word 는 원형숫자 글리프 보유. */
function docxRunsFromHtml(rawHtml: string, size = 20): TextRun[] {
  const html = cleanKeepU(rawHtml);
  const runs: TextRun[] = [];
  let underline = false;
  for (const part of html.split(/(<u>|<\/u>)/i)) {
    if (!part) continue;
    if (/^<u>$/i.test(part)) { underline = true; continue; }
    if (/^<\/u>$/i.test(part)) { underline = false; continue; }
    runs.push(new TextRun({ text: part, size, ...(underline ? { underline: {} } : {}) }));
  }
  if (runs.length === 0) runs.push(new TextRun({ text: '', size }));
  return runs;
}

interface QDoc {
  type: string;
  difficulty: string;
  textbook?: string;
  sourceKey?: string;
  category?: '교과서' | '부교재' | '모의고사';
  serialNo?: number;
  question_data: { Question?: string; Paragraph?: string; Options?: unknown; Answer?: string; CorrectAnswer?: string; Explanation?: string; Source?: string };
}

/** 교재 → 카테고리 (admin/passages 설정 + 모의고사 이름 패턴). */
const COVER_MOCK = /^\d{2}년\s+\d{1,2}월\s+고[123]\s+영어모의고사|^\d{2}년\s+고[123]\s+영어모의고사/;
function classifyCategory(tb: string, typeMap: Record<string, string>): '교과서' | '부교재' | '모의고사' {
  const t = typeMap[tb];
  if (t === '교과서' || t === '부교재' || t === '모의고사') return t;
  return COVER_MOCK.test(tb) || /영어모의고사$/.test(tb) ? '모의고사' : '부교재';
}
/** 출처 라벨: "교재 · Source" (교재명 길면 축약). */
function sourceLabel(textbook?: string, source?: string): string {
  const tb = (textbook ?? '').trim();
  const src = (source ?? '').trim();
  const shortTb = tb.length > 28 ? tb.slice(0, 28) + '…' : tb;
  return [shortTb, src].filter(Boolean).join(' · ');
}

export async function GET(request: NextRequest) {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;
  return buildDownload(request.nextUrl.searchParams);
}

/**
 * POST — 동일한 다운로드를 JSON 본문으로 받음. 서술형 지문 등 큰 데이터로 URL 이 길어져
 * GET 이 431(Request Header Fields Too Large)로 실패하는 것을 방지.
 */
export async function POST(request: NextRequest) {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;
  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }); }
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) { if (v !== undefined && v !== null) sp.set(k, String(v)); }
  return buildDownload(sp);
}

async function buildDownload(sp: URLSearchParams): Promise<NextResponse> {
  const format = sp.get('format') === 'docx' ? 'docx' : 'pdf';
  const ids = (sp.get('ids') || '').split(',').filter(Boolean);
  const title = (sp.get('title') || '변형문제').slice(0, 80);
  /** 표지(출처 분포) 페이지 포함 여부 — 기본 포함, cover=false면 제외 */
  const includeCover = sp.get('cover') !== 'false';
  /** 답안지 페이지 포함 여부 — 기본 포함, answerSheet=false면 제외 */
  const includeAnswerSheet = sp.get('answerSheet') !== 'false';
  /** 정답 전용 시트 — 'answers'(번호/정답 표) | 'quick'(빠른정답 조밀 그리드). 문제·표지 없이 정답만. */
  const sheetRaw = sp.get('sheet');
  const sheet: 'answers' | 'quick' | null = sheetRaw === 'answers' ? 'answers' : sheetRaw === 'quick' ? 'quick' : null;
  /** 표지 QR 주소 (학생 자가채점 /exam-grade/{token}). 있으면 표지에 QR 렌더 */
  const qrUrl = (sp.get('qr') || '').trim();
  /** 표지 부제용 학교/학년 */
  const coverSchool = (sp.get('schoolName') || '').slice(0, 60);
  const coverGradeRaw = sp.get('grade') || '';
  const coverGrade = /^[1-9]$/.test(coverGradeRaw) ? Number(coverGradeRaw) : null;
  /** 박스 헤더(실제 시험지 형식)용 메타 — 없으면 빈칸 */
  const examYear = (sp.get('examYear') || '').replace(/[^0-9]/g, '').slice(0, 4);
  const examTerm = (sp.get('examTerm') || '').slice(0, 30);
  const examSubject = (sp.get('subject') || '영어').slice(0, 20);
  const examTrack = (sp.get('track') || '').slice(0, 10);
  const examSubjectCode = (sp.get('subjectCode') || '').slice(0, 10);
  const examDate = (sp.get('examDate') || '').slice(0, 30);
  const examPeriod = (sp.get('period') || '').slice(0, 12);
  /** 객관식 배점 (ids 순서 정렬) */
  const objScores = (sp.get('scores') || '').split(',').map((s) => Number(s)).filter((n) => Number.isFinite(n));
  /** 객관식 출처 카테고리 (ids 순서 정렬) — 표지 분포용(범위 기준). 없으면 교재명으로 분류. */
  const objCategories = (sp.get('categories') || '').split(',').map((s) => s.trim());
  /** 서술형 문항 (기출 그대로, 객관식 뒤에 배치) */
  let subjectives: { question: string; paragraph: string; source: string; score: number; category?: string; type?: string }[] = [];
  try { const raw = sp.get('subjectives'); if (raw) subjectives = JSON.parse(raw); } catch { /* 무시 */ }
  if (ids.length === 0 && subjectives.length === 0) return NextResponse.json({ error: '문제 ID가 없습니다.' }, { status: 400 });

  const db = await getDb('gomijoshua');
  const [rawDocs, typeMetaDoc] = await Promise.all([
    db.collection('generated_questions')
      .find({ _id: { $in: ids.map((id) => new ObjectId(id)) }, status: '완료' })
      .toArray(),
    db.collection('settings').findOne({ _id: 'textbookTypeMeta' } as unknown as Record<string, unknown>),
  ]);
  const typeMap = (typeMetaDoc?.value && typeof typeMetaDoc.value === 'object') ? (typeMetaDoc.value as Record<string, string>) : {};

  const idIndex = new Map(ids.map((id, i) => [id, i]));
  const docs: QDoc[] = rawDocs
    .sort((a, b) => (idIndex.get(a._id.toString()) ?? 0) - (idIndex.get(b._id.toString()) ?? 0))
    .map((d) => {
      const tb = typeof d.textbook === 'string' ? d.textbook : '';
      const sk = typeof d.source_key === 'string' ? d.source_key
        : (d.chapter && d.number ? `${d.chapter} ${d.number}` : '');
      // 범위(scope) 카테고리 우선(올림포스처럼 원본 교재가 모의고사여도 부교재로 집계), 없으면 교재명 분류
      const passedCat = objCategories[idIndex.get(d._id.toString()) ?? -1];
      const category = (passedCat === '교과서' || passedCat === '부교재' || passedCat === '모의고사')
        ? passedCat : classifyCategory(tb, typeMap);
      return {
        type: d.type as string,
        difficulty: d.difficulty as string,
        textbook: tb,
        sourceKey: sk,
        category,
        serialNo: typeof d.serialNo === 'number' ? d.serialNo : undefined,
        question_data: (d.question_data as QDoc['question_data']) ?? {},
      };
    });

  if (docs.length === 0) return NextResponse.json({ error: '문제를 찾을 수 없습니다.' }, { status: 404 });

  /* ── 정답및해설(answers) / 빠른정답(quick) — 표지·문제 없이 정답(+해설)만 ── */
  if (format === 'pdf' && sheet) {
    const ansList: { num: number; answer: string }[] = docs.map((d, i) => ({
      num: i + 1,
      answer: clean(d.question_data.CorrectAnswer || d.question_data.Answer || ''),
    }));
    subjectives.forEach((_sj, j) => ansList.push({ num: docs.length + j + 1, answer: '서술형' }));
    // answers = 정답 및 해설 → 문항별 해설(Explanation) 동봉
    const details = sheet === 'answers'
      ? docs.map((d, i) => ({
          num: i + 1,
          answer: clean(d.question_data.CorrectAnswer || d.question_data.Answer || ''),
          src: sourceLabel(d.textbook, d.question_data.Source),
          serial: formatGeneratedSerial(d.serialNo),
          explanation: clean(d.question_data.Explanation || ''),
        }))
      : undefined;
    return buildAnswerOnlyPdf({ sheet, title, school: coverSchool, grade: coverGrade, answers: ansList, details });
  }

  /* ─────────────────── DOCX ─────────────────── */
  if (format === 'docx') {
    const children: (DocxParagraph | Table)[] = [
      new DocxParagraph({ children: [new TextRun({ text: title, bold: true, size: 36 })], heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER, spacing: { after: 400 } }),
    ];
    const answers: { num: number; answer: string }[] = [];

    if (includeCover) {
      const catCounts: Record<string, number> = { 교과서: 0, 부교재: 0, 모의고사: 0 };
      const typeCounts: Record<string, number> = {};
      for (const d of docs) { const c = d.category ?? '부교재'; catCounts[c] = (catCounts[c] ?? 0) + 1; typeCounts[d.type] = (typeCounts[d.type] ?? 0) + 1; }
      for (const sj of subjectives) { const c = (sj.category === '교과서' || sj.category === '부교재' || sj.category === '모의고사') ? sj.category : '교과서'; catCounts[c] = (catCounts[c] ?? 0) + 1; typeCounts['서술형'] = (typeCounts['서술형'] ?? 0) + 1; }
      const totalQ = docs.length + subjectives.length;
      const total = totalQ || 1;
      const totalScore = objScores.reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0) + subjectives.reduce((s, x) => s + (Number(x.score) || 0), 0);
      children.push(new DocxParagraph({ children: [new TextRun({ text: `총 ${totalQ}문항${totalScore > 0 ? `  ·  배점 합계 ${totalScore}점` : ''}`, size: 24, color: '6B7280' })], alignment: AlignmentType.CENTER, spacing: { after: 360 } }));
      children.push(new DocxParagraph({ children: [new TextRun({ text: '출처 분포', bold: true, size: 28 })], spacing: { after: 140 } }));
      for (const cat of ['교과서', '부교재', '모의고사']) { const n = catCounts[cat] ?? 0; if (!n) continue; children.push(new DocxParagraph({ children: [new TextRun({ text: `${cat}    ${n}문항 · ${Math.round((n / total) * 100)}%`, size: 22 })], spacing: { after: 60 } })); }
      children.push(new DocxParagraph({ children: [new TextRun({ text: '유형 분포', bold: true, size: 28 })], spacing: { before: 240, after: 140 } }));
      for (const [t, n] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) children.push(new DocxParagraph({ children: [new TextRun({ text: `${t}    ${n}문항`, size: 22 })], spacing: { after: 50 } }));
      children.push(new DocxParagraph({ pageBreakBefore: true, children: [] }));
    }

    docs.forEach((doc, idx) => {
      const qd = doc.question_data;
      const num = idx + 1;
      answers.push({ num, answer: clean(qd.CorrectAnswer || qd.Answer || '') });
      const question = clean(qd.Question || '');
      const srcText = sourceLabel(doc.textbook, qd.Source);
      const sc = objScores[idx];
      const srcLine = [srcText ? `출처) ${srcText}` : '', formatGeneratedSerial(doc.serialNo)].filter(Boolean).join('   ·   ');
      if (srcLine) children.push(new DocxParagraph({ children: [new TextRun({ text: srcLine, size: 14, color: '9CA3AF' })], spacing: { before: 200, after: 20 } }));
      children.push(
        new DocxParagraph({ children: [
          new TextRun({ text: `${num}.  ${question || `[${doc.type}]`}`, bold: true, size: 22 }),
          ...(Number.isFinite(sc) ? [new TextRun({ text: `   [${sc}점]`, size: 16, color: '6B7280' })] : []),
        ], spacing: { before: srcLine ? 0 : 240, after: 80 } }),
      );
      children.push(new DocxParagraph({ children: docxRunsFromHtml(qd.Paragraph || ''), spacing: { after: 80 } }));
      if (qd.Options) {
        const docxChoices = normalizeChoices(qd.Options);
        docxChoices.forEach((text, ci) => {
          const circ = CIRCLED[ci] ?? `${ci + 1}.`;
          children.push(new DocxParagraph({ children: [new TextRun({ text: `${circ} ${text}`.trimEnd(), size: 20 })], spacing: { after: 30 } }));
        });
      }
      children.push(new DocxParagraph({ children: [], spacing: { after: 120 } }));
    });

    // 서술형 섹션 (객관식 뒤)
    if (subjectives.length > 0) {
      children.push(new DocxParagraph({ children: [new TextRun({ text: '▶ 서술형', bold: true, size: 24, color: 'B45309' })], spacing: { before: 200, after: 100 } }));
      subjectives.forEach((sj, j) => {
        const num = docs.length + j + 1;
        const sc2 = Number(sj.score);
        answers.push({ num, answer: '서술형' });
        if (sj.source) children.push(new DocxParagraph({ children: [new TextRun({ text: `출처) ${sj.source}`, size: 14, color: '9CA3AF' })], spacing: { before: 200, after: 20 } }));
        children.push(new DocxParagraph({ children: [
          new TextRun({ text: `${num}.  ${clean(sj.question || '') || '[서술형]'}`, bold: true, size: 22 }),
          ...(Number.isFinite(sc2) ? [new TextRun({ text: `   [${sc2}점]`, size: 16, color: '6B7280' })] : []),
        ], spacing: { before: sj.source ? 0 : 200, after: 80 } }));
        if (sj.paragraph) children.push(new DocxParagraph({ children: docxRunsFromHtml(sj.paragraph), spacing: { after: 100 } }));
        children.push(new DocxParagraph({ children: [new TextRun({ text: '답) ', size: 18, color: '9CA3AF' })], spacing: { after: 260 } }));
      });
    }

    // 답안지 (옵션)
    if (includeAnswerSheet) {
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
    }

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
  const circledFont = loadCircledFont();
  const hasCircled = !!circledFont;
  if (circledFont) pdfDoc.registerFont('C', circledFont);

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

  const colDivider = () => {
    const divX = ML + COL_W + COL_GAP / 2;
    pdfDoc.moveTo(divX, HEADER_BOTTOM + 2).lineTo(divX, COL_BOTTOM - 4).strokeColor('#E5E7EB').lineWidth(0.5).stroke();
  };

  // ── 박스 헤더 (실제 시험지 형식) — 첫 문제 페이지 ──
  const drawBoxHeader = () => {
    const hX = ML, hY = MT, hW = FULL_W, hH = 50;
    const leftW = 138, rightW = 168, centerW = hW - leftW - rightW;
    const rightX = hX + leftW + centerW;
    // 외곽 + 세로 구분
    pdfDoc.lineWidth(1).strokeColor('#374151');
    pdfDoc.rect(hX, hY, hW, hH).stroke();
    pdfDoc.moveTo(hX + leftW, hY).lineTo(hX + leftW, hY + hH).stroke();
    pdfDoc.moveTo(rightX, hY).lineTo(rightX, hY + hH).stroke();
    // 좌: 3행 (학년도 / 시험 / 학교)
    const lrH = hH / 3;
    pdfDoc.lineWidth(0.4).strokeColor('#9CA3AF');
    pdfDoc.moveTo(hX, hY + lrH).lineTo(hX + leftW, hY + lrH).stroke();
    pdfDoc.moveTo(hX, hY + 2 * lrH).lineTo(hX + leftW, hY + 2 * lrH).stroke();
    pdfDoc.fillColor('#374151');
    pdfDoc.font('B').fontSize(8.5).text(examYear ? `${examYear}학년도` : '학년도', hX, hY + lrH / 2 - 5, { width: leftW, align: 'center' });
    pdfDoc.font('R').fontSize(8.5).text(examTerm || '정기고사', hX, hY + lrH + lrH / 2 - 5, { width: leftW, align: 'center' });
    pdfDoc.font('R').fontSize(8).text(coverSchool || '', hX, hY + 2 * lrH + lrH / 2 - 4.5, { width: leftW, align: 'center' });
    // 중앙: 제 N 학년 과목
    pdfDoc.font('B').fontSize(15).fillColor('#111827');
    const centerLabel = `제 ${coverGrade ?? ''} 학년 ${examSubject}`.replace(/\s+/g, ' ').trim();
    pdfDoc.text(centerLabel, hX + leftW, hY + hH / 2 - 10, { width: centerW, align: 'center' });
    // 우: 상단(계열|과목코드) + 하단(시험일자·교시)
    const rTopH = 30;
    pdfDoc.lineWidth(0.4).strokeColor('#9CA3AF');
    pdfDoc.moveTo(rightX, hY + rTopH).lineTo(rightX + rightW, hY + rTopH).stroke();
    pdfDoc.moveTo(rightX + rightW / 2, hY).lineTo(rightX + rightW / 2, hY + rTopH).stroke();
    pdfDoc.font('R').fontSize(7).fillColor('#6B7280');
    pdfDoc.text('계열', rightX, hY + 4, { width: rightW / 2, align: 'center' });
    pdfDoc.text('과목코드', rightX + rightW / 2, hY + 4, { width: rightW / 2, align: 'center' });
    pdfDoc.font('B').fontSize(9.5).fillColor('#111827');
    pdfDoc.text(examTrack || ' ', rightX, hY + 16, { width: rightW / 2, align: 'center' });
    pdfDoc.text(examSubjectCode || ' ', rightX + rightW / 2, hY + 16, { width: rightW / 2, align: 'center' });
    const dp = [examDate, examPeriod].filter(Boolean).join('   ');
    if (dp) pdfDoc.font('R').fontSize(8).fillColor('#374151').text(dp, rightX, hY + rTopH + (hH - rTopH) / 2 - 5, { width: rightW, align: 'center' });
    else pdfDoc.font('R').fontSize(8).fillColor('#B0B5BD').text('시험일자            교시', rightX, hY + rTopH + (hH - rTopH) / 2 - 5, { width: rightW, align: 'center' });
    colDivider();
  };

  // ── 헤더 (첫 페이지=박스 헤더, 이후=시험명 러닝 헤더)
  let pageHeaderCount = 0;
  const drawPageHeader = () => {
    pageHeaderCount++;
    if (pageHeaderCount === 1) { drawBoxHeader(); return; }
    pdfDoc.font('B').fontSize(11).fillColor('#374151').text(title, ML, MT + 8, { width: FULL_W, align: 'center' });
    pdfDoc.moveTo(ML, MT + 26).lineTo(ML + FULL_W, MT + 26).strokeColor('#374151').lineWidth(1).stroke();
    colDivider();
  };

  // ── 표지(출처·유형 분포) — 첫 페이지
  let coverQrBuf: Buffer | null = null;
  const drawCoverPage = () => {
    const catCounts: Record<string, number> = { 교과서: 0, 부교재: 0, 모의고사: 0 };
    const typeCounts: Record<string, number> = {};
    for (const d of docs) {
      const c = d.category ?? '부교재';
      catCounts[c] = (catCounts[c] ?? 0) + 1;
      typeCounts[d.type] = (typeCounts[d.type] ?? 0) + 1;
    }
    for (const sj of subjectives) {
      const c = (sj.category === '교과서' || sj.category === '부교재' || sj.category === '모의고사') ? sj.category : '교과서';
      catCounts[c] = (catCounts[c] ?? 0) + 1;
      typeCounts['서술형'] = (typeCounts['서술형'] ?? 0) + 1;
    }
    const totalQ = docs.length + subjectives.length;
    const total = totalQ || 1;
    const totalScore = objScores.reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0) + subjectives.reduce((s, x) => s + (Number(x.score) || 0), 0);

    // ── 팔레트 ──
    const GOLD = '#C9A44E', GOLD_DK = '#A6822F', INK = '#1F2937', SUBTLE = '#6B7280', FAINT = '#9CA3AF', LINE = '#E5E7EB';
    const catColors: Record<string, string> = { 교과서: '#059669', 부교재: '#D97706', 모의고사: '#2563EB' };
    const centerX = ML + FULL_W / 2;

    // 1) 상단 골드 별 엠블럼
    pdfDoc.save();
    pdfDoc.translate(centerX - 13.6, MT + 4);
    pdfDoc.scale(1.7);
    pdfDoc.path('M8 2L10.5 6.5L15 7.5L11.5 11L12.5 15.5L8 13L3.5 15.5L4.5 11L1 7.5L5.5 6.5L8 2Z').fill(GOLD);
    pdfDoc.restore();

    let cy = MT + 44;

    // 2) 제목
    pdfDoc.font('B').fontSize(21).fillColor(INK);
    const titleH = pdfDoc.heightOfString(title, { width: FULL_W, align: 'center', lineGap: 2 });
    pdfDoc.text(title, ML, cy, { width: FULL_W, align: 'center', lineGap: 2 });
    cy += titleH + 9;

    // 3) 골드 accent rule
    pdfDoc.moveTo(centerX - 26, cy).lineTo(centerX + 26, cy).lineWidth(1.6).strokeColor(GOLD).stroke();
    cy += 13;

    // 4) 부제 (학교 · 학년)
    const subParts = [coverSchool, coverGrade ? `${coverGrade}학년` : ''].filter(Boolean);
    if (subParts.length) {
      pdfDoc.font('R').fontSize(11.5).fillColor(SUBTLE).text(subParts.join('   ·   '), ML, cy, { width: FULL_W, align: 'center' });
      cy += 22;
    }

    // 5) 스탯 pill (객관식 / 서술형 / 배점)
    const pills: string[] = [`객관식 ${docs.length}문항`];
    if (subjectives.length) pills.push(`서술형 ${subjectives.length}문항`);
    if (totalScore > 0) pills.push(`배점 ${totalScore}점`);
    pdfDoc.font('B').fontSize(10);
    const pillPadX = 13, pillGap = 8, pillH = 23;
    const pillW = pills.map((p) => pdfDoc.widthOfString(p) + pillPadX * 2);
    const pillsTotalW = pillW.reduce((a, b) => a + b, 0) + pillGap * (pills.length - 1);
    let px = centerX - pillsTotalW / 2;
    cy += 4;
    pills.forEach((p, i) => {
      pdfDoc.roundedRect(px, cy, pillW[i], pillH, pillH / 2).fillAndStroke('#FBF6E9', GOLD);
      pdfDoc.font('B').fontSize(10).fillColor(GOLD_DK).text(p, px, cy + 7, { width: pillW[i], align: 'center' });
      px += pillW[i] + pillGap;
    });
    cy += pillH + 30;

    // ── 카드 헬퍼 ──
    const cardTitle = (x: number, ty: number, dot: string, label: string) => {
      pdfDoc.roundedRect(x + 18, ty + 1, 8, 8, 2).fill(dot);
      pdfDoc.font('B').fontSize(12).fillColor(INK).text(label, x + 32, ty);
    };

    // 6) 출처 분포 카드 (스택 바 + 범례)
    const c1H = 94;
    pdfDoc.roundedRect(ML, cy, FULL_W, c1H, 10).lineWidth(0.8).strokeColor(LINE).stroke();
    let iy = cy + 16;
    cardTitle(ML, iy, GOLD, '출처 분포');
    iy += 26;
    const sbX = ML + 18, sbW = FULL_W - 36, sbH = 16;
    const present = ['교과서', '부교재', '모의고사'].filter((c) => (catCounts[c] ?? 0) > 0);
    pdfDoc.roundedRect(sbX, iy, sbW, sbH, 5).fill('#F1F5F9');
    pdfDoc.save();
    pdfDoc.roundedRect(sbX, iy, sbW, sbH, 5).clip();
    let segX = sbX;
    for (const cat of present) {
      const segW = (sbW * (catCounts[cat] ?? 0)) / total;
      pdfDoc.rect(segX, iy, segW, sbH).fill(catColors[cat]);
      segX += segW;
    }
    pdfDoc.restore();
    iy += sbH + 13;
    let lx = sbX;
    pdfDoc.font('R').fontSize(9.5);
    for (const cat of present) {
      const n = catCounts[cat] ?? 0;
      const lbl = `${cat} ${n}문항 (${Math.round((n / total) * 100)}%)`;
      pdfDoc.circle(lx + 4, iy + 5, 4).fill(catColors[cat]);
      pdfDoc.font('R').fontSize(9.5).fillColor('#374151').text(lbl, lx + 13, iy + 1, { lineBreak: false });
      lx += 13 + pdfDoc.widthOfString(lbl) + 20;
    }
    cy += c1H + 16;

    // 7) 유형 분포 카드 (2열)
    const typeEntries = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
    const rows = Math.max(1, Math.ceil(typeEntries.length / 2));
    const c2H = 16 + 26 + rows * 18 + 12;
    pdfDoc.roundedRect(ML, cy, FULL_W, c2H, 10).lineWidth(0.8).strokeColor(LINE).stroke();
    let ty = cy + 16;
    cardTitle(ML, ty, '#2563EB', '유형 분포');
    ty += 28;
    const colW = (FULL_W - 36) / 2;
    typeEntries.forEach(([t, n], i) => {
      const ex = ML + 18 + (i % 2) * colW;
      const ey = ty + Math.floor(i / 2) * 18;
      pdfDoc.circle(ex + 2, ey + 5.5, 1.8).fill('#9CA3AF');
      pdfDoc.font('R').fontSize(10.5).fillColor('#374151').text(t, ex + 10, ey, { width: colW - 70, lineBreak: false });
      pdfDoc.font('R').fontSize(10.5).fillColor(SUBTLE).text(`${n}문항`, ex + colW - 60, ey, { width: 50, align: 'right', lineBreak: false });
    });
    cy += c2H + 16;

    // ── 하단: 응시자 정보 + QR 카드 (남은 공간에 세로 가운데 정렬) ──
    const availBottom = PAGE_H - MB;
    const qrSize = 122;
    const qrBoxW = 224, qrBoxH = coverQrBuf ? qrSize + 66 : 0;
    const nameRowH = 30, groupGap = 24;
    const groupH = nameRowH + (coverQrBuf ? groupGap + qrBoxH : 0);
    let gy = cy + Math.max(22, (availBottom - cy - groupH) / 2);

    // 응시자 정보 (이름 / 학번 / 번호)
    {
      const fields: [string, number][] = [['이름', 130], ['학번', 95], ['번호', 70]];
      pdfDoc.font('R').fontSize(10.5);
      const fieldGap = 26;
      const rowW = fields.reduce((s, [lbl, lw]) => s + pdfDoc.widthOfString(lbl) + 7 + lw, 0) + fieldGap * (fields.length - 1);
      let fx = centerX - rowW / 2;
      for (const [lbl, lw] of fields) {
        pdfDoc.font('R').fontSize(10.5).fillColor(SUBTLE).text(lbl, fx, gy, { lineBreak: false });
        const lblW = pdfDoc.widthOfString(lbl) + 7;
        pdfDoc.moveTo(fx + lblW, gy + 13).lineTo(fx + lblW + lw, gy + 13).lineWidth(0.6).strokeColor('#CBD5E1').stroke();
        fx += lblW + lw + fieldGap;
      }
      gy += nameRowH + groupGap;
    }

    // QR 자가채점 카드
    if (coverQrBuf) {
      const boxX = centerX - qrBoxW / 2;
      const boxY = gy;
      pdfDoc.roundedRect(boxX, boxY, qrBoxW, qrBoxH, 12).fill('#FBFBFD');
      pdfDoc.save();
      pdfDoc.roundedRect(boxX, boxY, qrBoxW, qrBoxH, 12).clip();
      pdfDoc.rect(boxX, boxY, qrBoxW, 4).fill(GOLD);
      pdfDoc.restore();
      pdfDoc.roundedRect(boxX, boxY, qrBoxW, qrBoxH, 12).lineWidth(0.8).strokeColor(LINE).stroke();
      pdfDoc.font('B').fontSize(11).fillColor(INK).text('QR 자가채점', boxX, boxY + 15, { width: qrBoxW, align: 'center' });
      pdfDoc.image(coverQrBuf, centerX - qrSize / 2, boxY + 33, { width: qrSize, height: qrSize });
      pdfDoc.font('R').fontSize(8).fillColor(FAINT).text('스마트폰으로 스캔 · 본인 전화번호로 채점', boxX + 8, boxY + qrBoxH - 16, { width: qrBoxW - 16, align: 'center' });
    }
  };

  if (includeCover) {
    if (qrUrl) {
      try {
        coverQrBuf = await QRCode.toBuffer(qrUrl, { type: 'png', margin: 1, width: 240, errorCorrectionLevel: 'M' });
      } catch { coverQrBuf = null; }
    }
    drawCoverPage();
    pdfDoc.addPage();
    col = 0;
    y = HEADER_BOTTOM;
  }
  drawPageHeader();

  const answers: { num: number; answer: string }[] = [];

  /* ── cx는 ensure() 이후 항상 재계산 (col이 바뀔 수 있음) ── */
  const cx = () => COL_X[col];

  /** 지문 렌더 — `<u>…</u>` 밑줄 + 본문 속 원형숫자(①②③④⑤)는 'C' 폰트로 표시. */
  const CIRCLED_CHARS = /[①②③④⑤⑥⑦⑧⑨⑩]/;
  const drawRichParagraph = (rawHtml: string, lineGap = 1.8) => {
    const html = cleanKeepU(rawHtml);
    if (!html) return;
    for (const line of html.split('\n')) {
      const plain = line.replace(/<\/?u>/gi, '');
      if (!plain.trim()) { y += lineH(9.5) * 0.4; continue; }
      const lh = pdfDoc.font('R').fontSize(9.5).heightOfString(plain, { width: COL_W - 10, lineGap });
      ensure(lh);
      // <u> 경계 + 원형숫자 단위로 세그먼트 분리
      const segs: { text: string; circled: boolean; underline: boolean }[] = [];
      let underline = false;
      for (const part of line.split(/(<u>|<\/u>)/i)) {
        if (!part) continue;
        if (/^<u>$/i.test(part)) { underline = true; continue; }
        if (/^<\/u>$/i.test(part)) { underline = false; continue; }
        let buf = '';
        for (const ch of part) {
          if (CIRCLED_CHARS.test(ch)) {
            if (buf) { segs.push({ text: buf, circled: false, underline }); buf = ''; }
            segs.push({ text: ch, circled: true, underline });
          } else buf += ch;
        }
        if (buf) segs.push({ text: buf, circled: false, underline });
      }
      if (segs.length === 0) { y += lh + 1; continue; }
      // 밑줄·원형숫자가 없는 평범한 줄은 양쪽 정렬(실제 시험지 느낌). 밑줄/원형숫자 줄은 continued 체인이라 left.
      const justifiable = segs.length === 1 && !segs[0].underline && !segs[0].circled;
      // 같은 줄 안에서 continued 체인으로 연결 (밑줄·폰트 세그먼트별 적용)
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        const last = i === segs.length - 1;
        const font = (s.circled && hasCircled) ? 'C' : 'R';
        pdfDoc.font(font).fontSize(9.5).fillColor('#111827');
        if (i === 0) pdfDoc.text(s.text, cx() + 8, y, { width: COL_W - 10, lineGap, align: justifiable ? 'justify' : 'left', underline: s.underline, continued: !last });
        else pdfDoc.text(s.text, { underline: s.underline, continued: !last });
      }
      y = pdfDoc.y + 1;
    }
    y += 7;
  };

  // ── 문제 렌더
  for (let i = 0; i < docs.length; i++) {
    const qd = docs[i].question_data;
    const num = i + 1;
    answers.push({ num, answer: clean(qd.CorrectAnswer || qd.Answer || '') });

    const para = clean(qd.Paragraph || '');
    const choices = qd.Options ? normalizeChoices(qd.Options) : [];
    const question = clean(qd.Question || '');
    const srcText = sourceLabel(docs[i].textbook, qd.Source);

    /* 전체 높이 추정 → 문제 단위로 칼럼 전환 */
    const numH = (question ? estHeight(question, COL_W - 22, 10, 2) : lineH(11)) + (srcText ? lineH(7.5) + 3 : 0) + 4;
    const paraH = para ? estHeight(para, COL_W - 10, 9.5, 5) : 0;
    const optsH = choices.reduce((s, l) => s + estHeight(l || '①', COL_W - 30, 9.5, 2.5), 0);
    const totalEst = numH + paraH + optsH + 14;

    ensure(Math.min(totalEst, COL_BOTTOM - HEADER_BOTTOM - 10)); // 너무 크면 부분 허용

    /* ── 출처 + 고유번호 (작은 글씨, 문제 위) ── */
    const serialLabel = formatGeneratedSerial(docs[i].serialNo);
    if (srcText || serialLabel) {
      if (srcText) pdfDoc.font('R').fontSize(7).fillColor('#9CA3AF').text(`출처) ${srcText}`, cx(), y, { width: COL_W - 58, lineBreak: false });
      if (serialLabel) pdfDoc.font('R').fontSize(7).fillColor('#B0B5BD').text(serialLabel, cx() + COL_W - 58, y, { width: 56, align: 'right', lineBreak: false });
      y += lineH(7) + 2;
    }

    /* ── 번호 + 발문 + 배점 ── */
    const score = objScores[i];
    const hasScore = Number.isFinite(score);
    const qWidth = COL_W - 22 - (hasScore ? 40 : 0);
    pdfDoc.font('B').fontSize(11).fillColor('#111827')
      .text(`${num}.`, cx(), y, { width: 20, lineBreak: false });
    if (hasScore) {
      pdfDoc.font('B').fontSize(8.5).fillColor('#6B7280')
        .text(`[${score}점]`, cx() + COL_W - 40, y + 1.5, { width: 40, align: 'right', lineBreak: false });
    }
    if (question) {
      const qh = pdfDoc.font('B').fontSize(10).heightOfString(question, { width: qWidth, lineGap: 1.5 });
      pdfDoc.font('B').fontSize(10).fillColor('#111827').text(question, cx() + 20, y, { width: qWidth, lineGap: 1.5 });
      y += qh + 5;
    } else {
      y += lineH(11) + 2;
    }

    /* ── 지문 (밑줄·원형숫자 포함, 양쪽 정렬) ── */
    if (para) {
      drawRichParagraph(qd.Paragraph || '', 2.3);
    }

    /* ── 선지 (원형숫자 ①②③④⑤ + 텍스트) ── */
    if (choices.length > 0) {
      const circW = 13;
      const textX = 14 + circW;
      const textW = COL_W - textX - 2;
      for (let ci = 0; ci < choices.length; ci++) {
        const circ = CIRCLED[ci] ?? `${ci + 1}.`;
        const text = choices[ci];
        const lh = text
          ? pdfDoc.font('R').fontSize(9.5).heightOfString(text, { width: textW, lineGap: 1 })
          : lineH(9.5);
        ensure(lh + 2);
        // 원형숫자 — CircledFallback(있으면) 아니면 "1." 형식 대체
        if (hasCircled) pdfDoc.font('C').fontSize(9.5).fillColor('#111827').text(circ, cx() + 14, y, { width: circW + 2, lineBreak: false });
        else pdfDoc.font('R').fontSize(9.5).fillColor('#111827').text(`${ci + 1}.`, cx() + 14, y, { width: circW + 2, lineBreak: false });
        // 선지 텍스트
        if (text) pdfDoc.font('R').fontSize(9.5).fillColor('#111827').text(text, cx() + textX, y, { width: textW, lineGap: 1 });
        y += lh + 3.8;
      }
    }

    /* ── 문제 간격 (구분선 없이 여백으로) ── */
    y += 15;
  }

  /* ── 서술형 섹션 (기출 그대로, 객관식 뒤) ── */
  if (subjectives.length > 0) {
    ensure(34);
    y += 6;
    pdfDoc.font('B').fontSize(10.5).fillColor('#B45309').text('▶ 서술형', cx(), y, { width: COL_W, lineBreak: false });
    y += lineH(10.5) + 5;
    for (let j = 0; j < subjectives.length; j++) {
      const sj = subjectives[j];
      const num = docs.length + j + 1;
      const q = clean(sj.question || '');
      const para = clean(sj.paragraph || '');
      const src = (sj.source || '').trim();
      const sc = Number(sj.score);
      answers.push({ num, answer: '서술형' });

      const qW = COL_W - 22 - (Number.isFinite(sc) ? 40 : 0);
      const estQ = q ? estHeight(q, qW, 10, 2) : lineH(11);
      const estP = para ? estHeight(para, COL_W - 10, 9.5, 5) : 0;
      ensure(Math.min(estQ + estP + 40, COL_BOTTOM - HEADER_BOTTOM - 10));

      if (src) { pdfDoc.font('R').fontSize(7).fillColor('#9CA3AF').text(`출처) ${src.length > 44 ? src.slice(0, 44) + '…' : src}`, cx(), y, { width: COL_W - 4, lineBreak: false }); y += lineH(7) + 2; }
      pdfDoc.font('B').fontSize(11).fillColor('#111827').text(`${num}.`, cx(), y, { width: 20, lineBreak: false });
      if (Number.isFinite(sc)) pdfDoc.font('B').fontSize(8.5).fillColor('#6B7280').text(`[${sc}점]`, cx() + COL_W - 40, y + 1.5, { width: 40, align: 'right', lineBreak: false });
      if (q) { const h = pdfDoc.font('B').fontSize(10).heightOfString(q, { width: qW, lineGap: 1.5 }); pdfDoc.font('B').fontSize(10).fillColor('#111827').text(q, cx() + 20, y, { width: qW, lineGap: 1.5 }); y += h + 2; } else { y += lineH(11) + 1; }
      if (para) {
        drawRichParagraph(sj.paragraph || '', 2.3);
      }
      // 답란 (밑줄 2칸)
      ensure(30);
      pdfDoc.font('R').fontSize(8).fillColor('#9CA3AF').text('답)', cx() + 6, y);
      pdfDoc.moveTo(cx() + 24, y + 11).lineTo(cx() + COL_W - 4, y + 11).strokeColor('#D1D5DB').lineWidth(0.4).stroke();
      pdfDoc.moveTo(cx() + 8, y + 24).lineTo(cx() + COL_W - 4, y + 24).strokeColor('#D1D5DB').lineWidth(0.4).stroke();
      y += 32;
      if (j < subjectives.length - 1) y += 6;
    }
  }

  /* ── 답안지 페이지 (옵션) ── */
  if (includeAnswerSheet) {
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
          .text(`${a.num}.`, cx2 + 8, aY.v + 6, { width: 18, lineBreak: false });
        const ans = a.answer.trim();
        const ansIsCircled = hasCircled && /^[①②③④⑤⑥⑦⑧⑨⑩]+$/.test(ans);
        pdfDoc.font(ansIsCircled ? 'C' : 'R').fontSize(9).fillColor('#1D4ED8')
          .text(ans, cx2 + 8 + 20, aY.v + 6, { width: cellW - 30, lineBreak: false });
        pdfDoc.fillColor('#111827');
      }
    }
    aY.v += rowH;
  }
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

/**
 * 정답 전용 PDF — 표지·문제 없이.
 *  - sheet='answers' : 번호/정답 5열 표 + 문항별 해설 (= 정답 및 해설)
 *  - sheet='quick'   : 10열 조밀 그리드 (빠른 채점용)
 */
async function buildAnswerOnlyPdf(opts: {
  sheet: 'answers' | 'quick';
  title: string;
  school: string;
  grade: number | null;
  answers: { num: number; answer: string }[];
  details?: { num: number; answer: string; src: string; serial: string; explanation: string }[];
}): Promise<NextResponse> {
  const { sheet, title, school, grade, answers, details } = opts;
  const [regularFont, boldFont] = await Promise.all([loadFont('Regular'), loadFont('Bold')]);
  const circledFont = loadCircledFont();
  const hasCircled = !!circledFont;

  const PAGE_W = 595.28, PAGE_H = 841.89, ML = 40, MR = 40, MT = 50, MB = 50;
  const FULL_W = PAGE_W - ML - MR;
  const doc = new PDFDocument({ size: 'A4', margins: { top: MT, bottom: MB, left: ML, right: MR }, autoFirstPage: true });
  doc.registerFont('R', regularFont);
  doc.registerFont('B', boldFont);
  if (circledFont) doc.registerFont('C', circledFont);
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));

  // 헤더
  const heading = sheet === 'quick' ? '빠른 정답' : '정답 및 해설';
  doc.font('B').fontSize(16).fillColor('#111827').text(`${title} — ${heading}`, ML, MT, { width: FULL_W, align: 'center' });
  const sub = [school, grade ? `${grade}학년` : '', `총 ${answers.length}문항`].filter(Boolean).join('  ·  ');
  doc.font('R').fontSize(9).fillColor('#6B7280').text(sub, ML, doc.y + 4, { width: FULL_W, align: 'center' });
  let y = doc.y + 14;
  doc.moveTo(ML, y).lineTo(ML + FULL_W, y).strokeColor('#374151').lineWidth(1).stroke();
  y += 12;

  const drawAns = (x: number, yy: number, num: number, ans: string, numW: number) => {
    doc.font('B').fontSize(sheet === 'quick' ? 9 : 10).fillColor('#111827').text(`${num}.`, x, yy, { width: numW, lineBreak: false });
    const isCirc = hasCircled && /^[①②③④⑤⑥⑦⑧⑨⑩]+$/.test(ans);
    doc.font(isCirc ? 'C' : 'R').fontSize(sheet === 'quick' ? 9 : 10).fillColor('#1D4ED8').text(ans || '·', x + numW, yy, { lineBreak: false });
  };

  // ── 정답 요약 표 ──
  const COLS = sheet === 'quick' ? 10 : 5;
  const cellW = FULL_W / COLS;
  const rowH = sheet === 'quick' ? 19 : 24;
  const rows = Math.ceil(answers.length / COLS);
  for (let r = 0; r < rows; r++) {
    if (y + rowH > PAGE_H - MB) { doc.addPage(); y = MT; }
    for (let c = 0; c < COLS; c++) {
      const a = answers[r * COLS + c];
      if (!a) continue;
      const x = ML + c * cellW;
      if (sheet === 'answers') {
        doc.rect(x, y, cellW, rowH).strokeColor('#D1D5DB').lineWidth(0.5).stroke();
        drawAns(x + 8, y + 7, a.num, a.answer, 22);
      } else {
        drawAns(x + 2, y + 5, a.num, a.answer, 17);
      }
    }
    y += rowH;
  }

  // ── 해설 (정답 및 해설) — 문항별 출처·정답·해설 ──
  if (sheet === 'answers' && details && details.length) {
    const CIRCLED_G = /[①②③④⑤⑥⑦⑧⑨⑩]/g;
    const CIRCLED_ONE = /[①②③④⑤⑥⑦⑧⑨⑩]/;
    /** 해설 본문 — 원형숫자(①②③)는 폴백 폰트(C)로, 줄바꿈 보존. */
    const drawExpText = (txt: string, x: number, width: number, fontSize: number) => {
      if (!txt) return;
      for (const line of txt.split('\n')) {
        if (!line.trim()) { y += fontSize * 0.7; continue; }
        const h = doc.font('R').fontSize(fontSize).heightOfString(line.replace(CIRCLED_G, 'O'), { width, lineGap: 1.5 });
        if (y + h > PAGE_H - MB) { doc.addPage(); y = MT; }
        const segs: { t: string; c: boolean }[] = [];
        let buf = '';
        for (const ch of line) {
          if (CIRCLED_ONE.test(ch)) { if (buf) { segs.push({ t: buf, c: false }); buf = ''; } segs.push({ t: ch, c: true }); }
          else buf += ch;
        }
        if (buf) segs.push({ t: buf, c: false });
        for (let i = 0; i < segs.length; i++) {
          const s = segs[i]; const last = i === segs.length - 1;
          doc.font((s.c && hasCircled) ? 'C' : 'R').fontSize(fontSize).fillColor('#374151');
          if (i === 0) doc.text(s.t, x, y, { width, lineGap: 1.5, continued: !last });
          else doc.text(s.t, { continued: !last });
        }
        y = doc.y + 2;
      }
    };

    if (y + 30 > PAGE_H - MB) { doc.addPage(); y = MT; }
    y += 12;
    doc.font('B').fontSize(12).fillColor('#111827').text('■ 해설', ML, y);
    y = doc.y + 5;
    doc.moveTo(ML, y).lineTo(ML + FULL_W, y).strokeColor('#D1D5DB').lineWidth(0.6).stroke();
    y += 9;

    for (const d of details) {
      if (y + 44 > PAGE_H - MB) { doc.addPage(); y = MT; }
      const metaRight = [d.src ? `출처) ${d.src}` : '', d.serial].filter(Boolean).join('   ·   ');
      const isCirc = hasCircled && /^[①②③④⑤⑥⑦⑧⑨⑩]+$/.test(d.answer);
      const startY = y;
      doc.font('B').fontSize(10.5).fillColor('#111827').text(`${d.num}.`, ML, startY, { width: 22, lineBreak: false });
      if (metaRight) doc.font('R').fontSize(7.5).fillColor('#9CA3AF').text(metaRight, ML + 150, startY + 2, { width: FULL_W - 150, align: 'right', lineBreak: false });
      doc.font('B').fontSize(10.5).fillColor('#1D4ED8').text('정답 ', ML + 22, startY, { continued: true });
      doc.font(isCirc ? 'C' : 'B').fontSize(10.5).fillColor('#1D4ED8').text(d.answer || '·', { continued: false });
      y = doc.y + 4;
      if (d.explanation) drawExpText(d.explanation, ML + 4, FULL_W - 4, 9.5);
      else { doc.font('R').fontSize(9).fillColor('#9CA3AF').text('— 해설 없음 —', ML + 4, y); y = doc.y + 2; }
      y += 9;
    }
  }

  doc.end();
  const buf = await new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  const fname = `${title} ${heading}.pdf`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(fname)}"`,
    },
  });
}
