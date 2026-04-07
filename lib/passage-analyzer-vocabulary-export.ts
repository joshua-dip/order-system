import type { VocabularyEntry } from '@/lib/passage-analyzer-types';
import { passageAnalysisFileNameForPassageId } from '@/lib/passage-analyzer-types';
import { sortVocabularyEntries, VOCABULARY_WORD_TYPE_LABELS, type VocabularySortOrder } from '@/lib/passage-analyzer-vocabulary';

/** 단일 지문 시트 헤더 (번호 = 표시 순번) */
export const VOCAB_SINGLE_SHEET_HEADERS = [
  '번호',
  '단어',
  '유형',
  '품사',
  'CEFR',
  '뜻',
  '영어유의어',
  '영어반의어',
  '기타',
  '위치',
] as const;

export type PassageListRowForExport = {
  _id: unknown;
  textbook?: string;
  chapter?: string;
  number?: string;
  source_key?: string;
};

function positionLabel(item: VocabularyEntry): string {
  return (
    (item.positions || [])
      .map((p) => `${p.sentence + 1}-${p.position + 1}`)
      .join(', ') || ''
  );
}

/** 단일 지문 단어장 → 시트용 2차원 배열 (첫 행 헤더) */
export function buildSinglePassageVocabularyAoA(
  entries: VocabularyEntry[],
  sortOrder: VocabularySortOrder
): (string | number)[][] {
  const sorted = sortVocabularyEntries(entries, sortOrder);
  const rows: (string | number)[][] = [[...VOCAB_SINGLE_SHEET_HEADERS]];
  sorted.forEach((item, displayIdx) => {
    rows.push([
      displayIdx + 1,
      item.word,
      VOCABULARY_WORD_TYPE_LABELS[item.wordType || 'word'] ?? (item.wordType || 'word'),
      item.partOfSpeech || '',
      item.cefr || '',
      item.meaning || '',
      item.synonym || '',
      item.antonym || '',
      item.opposite || '',
      positionLabel(item),
    ]);
  });
  return rows;
}

const TEXTBOOK_SHEET_HEADERS = [
  '교재',
  '회차',
  '번호',
  'source_key',
  'passageId',
  '단어순번',
  '단어',
  '유형',
  '품사',
  'CEFR',
  '뜻',
  '영어유의어',
  '영어반의어',
  '기타',
  '위치',
] as const;

/**
 * 교재에 속한 지문들 + fileName → 단어장 맵으로 통합 시트 데이터 생성.
 * 단어는 지문 내 위치순으로 정렬.
 */
export function buildTextbookVocabularyAoA(
  passages: PassageListRowForExport[],
  vocabByFileName: Map<string, VocabularyEntry[]>
): (string | number)[][] {
  const rows: (string | number)[][] = [[...TEXTBOOK_SHEET_HEADERS]];
  for (const p of passages) {
    const pid = String(p._id);
    const fn = passageAnalysisFileNameForPassageId(pid);
    const list = vocabByFileName.get(fn);
    if (!list?.length) continue;
    const sorted = sortVocabularyEntries(list, 'position');
    const tb = String(p.textbook ?? '');
    const ch = String(p.chapter ?? '');
    const num = String(p.number ?? '');
    const sk = String(p.source_key ?? '');
    sorted.forEach((item, i) => {
      rows.push([
        tb,
        ch,
        num,
        sk,
        pid,
        i + 1,
        item.word,
        VOCABULARY_WORD_TYPE_LABELS[item.wordType || 'word'] ?? (item.wordType || 'word'),
        item.partOfSpeech || '',
        item.cefr || '',
        item.meaning || '',
        item.synonym || '',
        item.antonym || '',
        item.opposite || '',
        positionLabel(item),
      ]);
    });
  }
  return rows;
}

export function sanitizeExcelFileBase(name: string, maxLen = 48): string {
  const t = name
    .replace(/[/\\:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return (t || 'export').slice(0, maxLen);
}
