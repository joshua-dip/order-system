/**
 * 지문(passages) → 엑셀 추출용 행 빌더.
 * 컬럼 양식은 업로드/배포에 쓰는 「한줄해석」 엑셀과 동일하게 맞춘다.
 *   교재명 · 강 · 페이지 · 순서 · 번호 · 원문 · 해석 ·
 *   문장구분(영) · 문장구분(한) ·
 *   Tokenized Sentences (English) · Tokenized Sentences (Korean) · Mixed Sentences
 */

export const PASSAGE_EXPORT_HEADERS = [
  '교재명',
  '강',
  '페이지',
  '순서',
  '번호',
  '원문',
  '해석',
  '문장구분(영)',
  '문장구분(한)',
  'Tokenized Sentences (English)',
  'Tokenized Sentences (Korean)',
  'Mixed Sentences',
] as const;

export interface PassageExportContent {
  original?: string;
  translation?: string;
  sentences_en?: string[];
  sentences_ko?: string[];
  tokenized_en?: string;
  tokenized_ko?: string;
  mixed?: string;
}

export interface PassageExportDoc {
  textbook?: string;
  chapter?: string;
  page?: string;
  order?: number;
  number?: string;
  content?: PassageExportContent;
}

/** 번호("18번","41~42번")에서 앞쪽 정수 추출 — 정렬·순서 키. */
function numKey(number?: string): number {
  const m = String(number ?? '').match(/\d+/);
  return m ? parseInt(m[0], 10) : 999999;
}

/** 교재 → 강 → (order|번호) 순으로 정렬. */
export function sortPassagesForExport<T extends PassageExportDoc>(passages: T[]): T[] {
  return [...passages].sort((a, b) => {
    const t = String(a.textbook ?? '').localeCompare(String(b.textbook ?? ''), 'ko', { numeric: true });
    if (t !== 0) return t;
    const c = String(a.chapter ?? '').localeCompare(String(b.chapter ?? ''), 'ko', { numeric: true });
    if (c !== 0) return c;
    const oa = typeof a.order === 'number' ? a.order : numKey(a.number);
    const ob = typeof b.order === 'number' ? b.order : numKey(b.number);
    if (oa !== ob) return oa - ob;
    return String(a.number ?? '').localeCompare(String(b.number ?? ''), 'ko', { numeric: true });
  });
}

/** 셀 줄바꿈은 LF(\n)만 사용. CR(\r)을 넣으면 xlsx 에 `_x000d_` 로 escape 되어 깨져 보임. */
const cell = (v: unknown): string => String(v ?? '').replace(/\r\n?/g, '\n');

const sentToString = (v: unknown): string =>
  Array.isArray(v) ? v.map((x) => String(x ?? '')).join('\n') : '';

/**
 * 정렬된 지문들을 AoA(헤더 + 데이터 행)로 변환. 순서 컬럼은 (교재,강) 그룹마다 1부터.
 * passage.order 가 숫자면 그 값을, 없으면 그룹 내 순번을 쓴다.
 */
export function buildPassagesExportRows(
  passages: PassageExportDoc[],
  opts?: { preserveOrder?: boolean },
): (string | number)[][] {
  const sorted = opts?.preserveOrder ? passages : sortPassagesForExport(passages);
  const rows: (string | number)[][] = [[...PASSAGE_EXPORT_HEADERS]];
  let seq = 0;
  let lastTb: string | null = null;
  let lastCh: string | null = null;
  for (const p of sorted) {
    const tb = p.textbook ?? '';
    const ch = p.chapter ?? '';
    if (tb !== lastTb || ch !== lastCh) {
      seq = 0;
      lastTb = tb;
      lastCh = ch;
    }
    seq += 1;
    const c = p.content ?? {};
    rows.push([
      p.textbook ?? '',
      p.chapter ?? p.textbook ?? '',
      p.page ?? '',
      typeof p.order === 'number' ? p.order : seq,
      p.number ?? '',
      cell(c.original),
      cell(c.translation),
      sentToString(c.sentences_en),
      sentToString(c.sentences_ko),
      cell(c.tokenized_en),
      cell(c.tokenized_ko),
      cell(c.mixed),
    ]);
  }
  return rows;
}
