import path from 'path';
import fs from 'fs';

// pdfkit·xlsx·docx는 각 빌드 함수 내부에서 dynamic import.
// 파일 자체를 import해도 무거운 라이브러리가 즉시 로드되지 않도록 격리.

const CIRCLED: Record<string, string> = {
  '①': '(1)',
  '②': '(2)',
  '③': '(3)',
  '④': '(4)',
  '⑤': '(5)',
};

let fontCache: Buffer | null = null;

const FONT_CANDIDATE_URLS = [
  'https://raw.githubusercontent.com/google/fonts/main/ofl/nanumgothic/NanumGothic-Regular.ttf',
  'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/nanumgothic/NanumGothic-Regular.ttf',
];

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'next-order-member-variant-export/1.0' },
    });
  } finally {
    clearTimeout(t);
  }
}

export async function getKoreanFontBuffer(): Promise<Buffer> {
  if (fontCache) return fontCache;

  const envPath = process.env.MEMBER_VARIANT_KOREAN_FONT_PATH?.trim();
  if (envPath && fs.existsSync(envPath)) {
    fontCache = fs.readFileSync(envPath);
    if (fontCache.length > 50_000) return fontCache;
    fontCache = null;
  }

  const localPath = path.join(process.cwd(), 'lib', 'fonts', 'NanumGothic-Regular.ttf');
  if (fs.existsSync(localPath)) {
    fontCache = fs.readFileSync(localPath);
    if (fontCache.length > 50_000) return fontCache;
    fontCache = null;
  }

  const envUrl = process.env.MEMBER_VARIANT_KOREAN_FONT_URL?.trim();
  const urls = [...(envUrl ? [envUrl] : []), ...FONT_CANDIDATE_URLS];
  for (const url of urls) {
    try {
      const res = await fetchWithTimeout(url, 20_000);
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 50_000) {
        fontCache = buf;
        return fontCache;
      }
    } catch {
      /* try next URL */
    }
  }
  throw new Error('한글 폰트를 불러올 수 없습니다. lib/fonts/NanumGothic-Regular.ttf 배포 여부를 확인하세요.');
}

/** XLSX 셀·XML에 깨지는 제어문자 제거 */
export function sanitizeExportCellText(s: string): string {
  return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

export function safeExportText(s: string): string {
  let r = s.replace(/①|②|③|④|⑤/g, (m) => CIRCLED[m] || m);
  r = r.replace(/<[^>]*>/g, '');
  return r;
}

/** docx/pdf 등에 넣기 전: HTML 제거 + 제어문자 제거 */
export function exportPlainText(s: string): string {
  return sanitizeExportCellText(safeExportText(s));
}

export type ExportMode = 'student' | 'teacher';

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

/** 서술형 유형 여부 판단 */
const ESSAY_TYPE_PREFIXES = ['요약문'];
export function isEssayQuestionType(type: string): boolean {
  return ESSAY_TYPE_PREFIXES.some((p) => type.startsWith(p));
}

/** 워크북 어법 유형 여부 판단 */
export function isWorkbookGrammarType(type: string): boolean {
  return type === '워크북어법';
}

/** 워크북 유형 일반 판단 (향후 워크북빈칸 등 포함) */
export function isWorkbookType(type: string): boolean {
  return type.startsWith('워크북');
}

/**
 * generated_workbooks doc (snake_case) → PascalCase 변환 어댑터.
 * 기존 generated_questions 의 question_data (PascalCase) 도 그대로 통과.
 */
function normalizeWorkbookDataToPascal(qd: Record<string, unknown>): Record<string, unknown> {
  if (typeof qd.Paragraph === 'string') return qd;
  return {
    ...qd,
    Paragraph: qd.paragraph ?? qd.Paragraph ?? '',
    AnswerText: qd.answer_text ?? qd.AnswerText ?? '',
    Explanation: qd.explanation ?? qd.Explanation ?? '',
    GrammarPoints: qd.grammar_points ?? qd.GrammarPoints ?? [],
  };
}

/** 워크북 어법 question_data에서 섹션 목록 추출 */
export function flattenWorkbookGrammarData(
  qd: Record<string, unknown>,
  mode: ExportMode,
): { label: string; text: string }[] {
  const norm = normalizeWorkbookDataToPascal(qd);
  const sections: { label: string; text: string }[] = [];
  const paragraph = str(norm.Paragraph).trim();
  const answerText = str(norm.AnswerText).trim();
  const explanation = str(norm.Explanation).trim();

  if (paragraph) sections.push({ label: '지문(양자택일)', text: paragraph });

  if (mode === 'teacher') {
    if (answerText) sections.push({ label: '정답', text: answerText });
    if (explanation) sections.push({ label: '해설', text: explanation });
  }

  return sections;
}

/** 서술형 question_data에서 섹션 목록 추출 */
export function flattenEssayQuestionData(
  qd: Record<string, unknown>,
  mode: ExportMode,
): { label: string; text: string }[] {
  const sections: { label: string; text: string }[] = [];
  const add = (label: string, key: string) => {
    const v = str(qd[key]).trim().replace(/\\n/g, '\n');
    if (v) sections.push({ label, text: v });
  };

  add('발문', 'Question');
  add('지문', 'Paragraph');
  add('조건', 'Conditions');
  add('요약문 틀', 'SummaryFrame');

  if (Array.isArray(qd.WordBank)) {
    const words = (qd.WordBank as unknown[]).filter((w): w is string => typeof w === 'string');
    if (words.length > 0) {
      sections.push({ label: '배열할 단어', text: words.join(' / ') });
    }
  }

  if (mode === 'teacher') {
    add('모범 답안', 'SampleAnswer');
    add('해설', 'Explanation');
    if (Array.isArray(qd.Keywords)) {
      const kws = (qd.Keywords as unknown[]).filter((k): k is string => typeof k === 'string');
      if (kws.length > 0) {
        sections.push({ label: '정답 어휘', text: kws.join(', ') });
      }
    }
  }

  return sections;
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
  const XLSX = await import('xlsx');
  const rows: (string | number)[][] = [
    ['번호', '유형', '난이도', '교재', '출처', '상태', '저장일시', '발문', '지문(양자택일)', '선택지', '정답', '해설'],
  ];
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i];
    const qd = d.question_data ?? {};
    const docType = str(d.type);
    const created =
      d.created_at instanceof Date
        ? d.created_at.toISOString().replace('T', ' ').slice(0, 19)
        : '';

    if (isWorkbookGrammarType(docType)) {
      const sections = flattenWorkbookGrammarData(qd, 'teacher');
      const paragraphCell = sections.find((s) => s.label === '지문(양자택일)')?.text ?? '';
      const answerCell = sections.find((s) => s.label === '정답')?.text ?? '';
      const explanationCell = sections.find((s) => s.label === '해설')?.text ?? '';
      rows.push([
        i + 1,
        exportPlainText(docType),
        exportPlainText(str(d.difficulty)),
        exportPlainText(str(d.textbook)),
        exportPlainText(str(d.source)),
        exportPlainText(str(d.status)),
        sanitizeExportCellText(created),
        '',
        exportPlainText(paragraphCell),
        '',
        exportPlainText(answerCell),
        exportPlainText(explanationCell),
      ]);
    } else {
      const f = flattenMemberQuestionData(qd);
      rows.push([
        i + 1,
        exportPlainText(docType),
        exportPlainText(str(d.difficulty)),
        exportPlainText(str(d.textbook)),
        exportPlainText(str(d.source)),
        exportPlainText(str(d.status)),
        sanitizeExportCellText(created),
        exportPlainText(f.question),
        exportPlainText(f.paragraph),
        exportPlainText(f.optionsDisplay),
        exportPlainText(f.answer),
        exportPlainText(f.explanation),
      ]);
    }
  }
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, '문항');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

export async function buildMemberVariantDocxBuffer(
  docs: MemberVariantExportDoc[],
  mode: ExportMode = 'teacher',
): Promise<Buffer> {
  const { Document, Packer, Paragraph: DocxParagraph, TextRun, HeadingLevel, AlignmentType } =
    await import('docx');

  const sections = docs.map((doc, idx) => {
    const qd = doc.question_data ?? {};
    const docType = str(doc.type);
    const isEssay = isEssayQuestionType(docType);
    const isWorkbook = isWorkbookGrammarType(docType);
    const header = `${idx + 1}. [${exportPlainText(docType)}] (${exportPlainText(str(doc.difficulty))}) · ${exportPlainText(str(doc.textbook))}`;

    const children: InstanceType<typeof DocxParagraph>[] = [
      new DocxParagraph({
        children: [new TextRun({ text: header, bold: true, size: 22 })],
        spacing: { after: 120 },
      }),
    ];

    if (isWorkbook) {
      for (const { label, text } of flattenWorkbookGrammarData(qd, mode)) {
        const isAnswer = label === '정답';
        const isNote = label === '해설';
        children.push(
          new DocxParagraph({
            children: [
              new TextRun({
                text: `[${label}]`,
                bold: true,
                size: isNote ? 18 : 20,
                color: isAnswer ? '16A34A' : isNote ? '6B7280' : '000000',
              }),
            ],
            spacing: { before: 120, after: 40 },
          }),
        );
        for (const line of exportPlainText(text).split(/\n/).filter(Boolean)) {
          children.push(
            new DocxParagraph({
              children: [
                new TextRun({
                  text: line,
                  size: isNote ? 18 : 20,
                  italics: isNote,
                  color: isAnswer ? '16A34A' : isNote ? '6B7280' : '000000',
                }),
              ],
              spacing: { after: 30 },
            }),
          );
        }
      }
    } else if (isEssay) {
      for (const { label, text } of flattenEssayQuestionData(qd, mode)) {
        const isAnswer = label === '모범 답안';
        const isNote = label === '해설' || label === '정답 어휘';
        children.push(
          new DocxParagraph({
            children: [
              new TextRun({
                text: `[${label}]`,
                bold: true,
                size: isNote ? 18 : 20,
                color: isAnswer ? '16A34A' : isNote ? '6B7280' : '000000',
              }),
            ],
            spacing: { before: 120, after: 40 },
          }),
        );
        for (const line of exportPlainText(text).split(/\n/).filter(Boolean)) {
          children.push(
            new DocxParagraph({
              children: [
                new TextRun({
                  text: line,
                  size: isNote ? 18 : 20,
                  italics: isNote,
                  color: isAnswer ? '16A34A' : isNote ? '6B7280' : '000000',
                }),
              ],
              spacing: { after: 30 },
            }),
          );
        }
      }
    } else {
      const f = flattenMemberQuestionData(qd);
      if (f.question) {
        children.push(
          new DocxParagraph({
            children: [new TextRun({ text: `발문: ${exportPlainText(f.question)}`, size: 20 })],
            spacing: { after: 80 },
          }),
        );
      }
      if (f.paragraph) {
        children.push(
          new DocxParagraph({
            children: [new TextRun({ text: exportPlainText(f.paragraph), size: 20 })],
            spacing: { after: 80 },
          }),
        );
      }
      if (f.optionsDisplay) {
        for (const line of exportPlainText(f.optionsDisplay).split(/\n/).filter(Boolean)) {
          children.push(
            new DocxParagraph({ children: [new TextRun({ text: line, size: 20 })], spacing: { after: 40 } }),
          );
        }
      }
      if (mode === 'teacher') {
        children.push(
          new DocxParagraph({
            children: [new TextRun({ text: `정답: ${exportPlainText(f.answer)}`, bold: true, size: 20, color: '2563EB' })],
            spacing: { before: 80, after: 40 },
          }),
        );
        if (f.explanation) {
          children.push(
            new DocxParagraph({
              children: [
                new TextRun({ text: `해설: ${exportPlainText(f.explanation)}`, size: 18, italics: true, color: '6B7280' }),
              ],
              spacing: { after: 200 },
            }),
          );
        }
      }
    }
    return children;
  });

  const titleSuffix = mode === 'student' ? ' (학생용)' : ' (교사용)';
  const docxDoc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new DocxParagraph({
            children: [new TextRun({ text: `회원 변형 문항${titleSuffix}`, bold: true, size: 32 })],
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

export async function buildMemberVariantPdfBuffer(
  docs: MemberVariantExportDoc[],
  mode: ExportMode = 'teacher',
): Promise<Buffer> {
  const { default: PDFDocument } = await import('pdfkit');
  const fontBuf = await getKoreanFontBuffer();
  const pdfDoc = new PDFDocument({ size: 'A4', margins: { top: 50, bottom: 50, left: 50, right: 50 } });
  pdfDoc.registerFont('Korean', fontBuf);
  pdfDoc.font('Korean');

  const chunks: Buffer[] = [];
  pdfDoc.on('data', (c: Buffer) => chunks.push(c));

  const titleSuffix = mode === 'student' ? ' (학생용)' : ' (교사용)';
  pdfDoc.fontSize(18).text(`회원 변형 문항${titleSuffix}`, { align: 'center' });
  pdfDoc.moveDown(1);

  for (let i = 0; i < docs.length; i++) {
    const d = docs[i];
    const qd = d.question_data ?? {};
    const docType = str(d.type);
    const isEssay = isEssayQuestionType(docType);
    const isWorkbook = isWorkbookGrammarType(docType);

    if (i > 0) pdfDoc.moveDown(0.5);
    if (pdfDoc.y > 700) pdfDoc.addPage();

    pdfDoc
      .fontSize(11)
      .fillColor('#000000')
      .text(
        `${i + 1}. [${exportPlainText(docType)}] (${exportPlainText(str(d.difficulty))}) · ${exportPlainText(str(d.textbook))}`,
        { continued: false },
      );

    if (isWorkbook) {
      for (const { label, text } of flattenWorkbookGrammarData(qd, mode)) {
        const isAnswer = label === '정답';
        const isNote = label === '해설';
        pdfDoc.moveDown(0.3);
        pdfDoc
          .fontSize(isNote ? 9 : 10)
          .fillColor(isAnswer ? '#16A34A' : isNote ? '#6B7280' : '#000000')
          .text(`[${label}]`, { continued: false });
        for (const line of exportPlainText(text).split(/\n/).filter(Boolean)) {
          pdfDoc.text(line, { lineGap: 2 });
        }
        pdfDoc.fillColor('#000000').fontSize(10);
      }
    } else if (isEssay) {
      for (const { label, text } of flattenEssayQuestionData(qd, mode)) {
        const isAnswer = label === '모범 답안';
        const isNote = label === '해설' || label === '정답 어휘';
        pdfDoc.moveDown(0.3);
        pdfDoc
          .fontSize(isNote ? 9 : 10)
          .fillColor(isAnswer ? '#16A34A' : isNote ? '#6B7280' : '#000000')
          .text(`[${label}]`, { continued: false });
        for (const line of exportPlainText(text).split(/\n/).filter(Boolean)) {
          pdfDoc.text(line, { lineGap: 2 });
        }
        pdfDoc.fillColor('#000000').fontSize(10);
      }
    } else {
      const f = flattenMemberQuestionData(qd);
      if (f.question) {
        pdfDoc.fontSize(10).text(`발문: ${exportPlainText(f.question)}`, { lineGap: 3 });
      }
      if (f.paragraph) {
        pdfDoc.fontSize(10).text(exportPlainText(f.paragraph), { lineGap: 3 });
      }
      if (f.optionsDisplay) {
        pdfDoc.moveDown(0.3);
        for (const line of exportPlainText(f.optionsDisplay).split(/\n/).filter(Boolean)) {
          pdfDoc.text(line);
        }
      }
      if (mode === 'teacher') {
        pdfDoc.moveDown(0.3);
        pdfDoc.fillColor('#2563EB').text(`정답: ${exportPlainText(f.answer)}`, { continued: false });
        pdfDoc.fillColor('#000000');
        if (f.explanation) {
          pdfDoc.fontSize(9).fillColor('#6B7280').text(`해설: ${exportPlainText(f.explanation)}`);
          pdfDoc.fillColor('#000000').fontSize(10);
        }
      }
    }

    pdfDoc.moveDown(0.5);
    pdfDoc.strokeColor('#E5E7EB').lineWidth(0.5).moveTo(50, pdfDoc.y).lineTo(545, pdfDoc.y).stroke();
  }

  pdfDoc.end();
  return await new Promise<Buffer>((resolve) => pdfDoc.on('end', () => resolve(Buffer.concat(chunks))));
}
