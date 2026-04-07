import type { VocabularyEntry } from '@/lib/passage-analyzer-types';

const BATCH_SIZE = 12;

export type VocabularySortOrder = 'original' | 'alphabetical' | 'position';

export const VOCABULARY_WORD_TYPE_OPTIONS = ['word', 'phrase'] as const;

export const VOCABULARY_WORD_TYPE_LABELS: Record<string, string> = {
  word: '단어',
  phrase: '숙어',
};

export const VOCABULARY_POS_OPTIONS = [
  'n.',
  'v.',
  'adj.',
  'adv.',
  'prep.',
  'conj.',
  'pron.',
  'int.',
  'art. / det.',
  'n. phrase',
  'v. phrase',
  'adj. phrase',
  'adv. phrase',
  'prep. phrase',
] as const;

/** 단어장 CEFR — 첫 값 '' 은 UI에서 「미지정」 */
export const VOCABULARY_CEFR_OPTIONS = ['', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;

export function sortVocabularyEntries(
  list: VocabularyEntry[],
  order: VocabularySortOrder
): VocabularyEntry[] {
  const copy = [...list];
  if (order === 'alphabetical') {
    copy.sort((a, b) => a.word.toLowerCase().localeCompare(b.word.toLowerCase()));
  } else if (order === 'position') {
    copy.sort((a, b) => {
      const pa = a.positions?.[0];
      const pb = b.positions?.[0];
      if (!pa && !pb) return 0;
      if (!pa) return 1;
      if (!pb) return -1;
      if (pa.sentence !== pb.sentence) return pa.sentence - pb.sentence;
      return pa.position - pb.position;
    });
  }
  return copy;
}

/** 정렬 목록 기준 표시 번호(1~) — 같은 토큰은 첫 등장 번호 */
export function vocabularyPositionToDisplayIndex(sorted: VocabularyEntry[]): Map<string, number> {
  const m = new Map<string, number>();
  sorted.forEach((item, idx) => {
    for (const p of item.positions || []) {
      const key = `${p.sentence}:${p.position}`;
      if (!m.has(key)) m.set(key, idx + 1);
    }
  });
  return m;
}

export function regenerateVocabularyPositions(
  list: VocabularyEntry[],
  sentences: string[]
): VocabularyEntry[] {
  return list.map((entry) => {
    const target = entry.word.replace(/[.,;:!?'"`]/g, '').trim();
    if (!target) return entry;
    const positions: { sentence: number; position: number }[] = [];
    for (let si = 0; si < sentences.length; si++) {
      const words = sentences[si].split(/\s+/).filter(Boolean);
      for (let wi = 0; wi < words.length; wi++) {
        const tw = words[wi].replace(/[.,;:!?'"`]/g, '').toLowerCase();
        if (tw === target.toLowerCase()) {
          positions.push({ sentence: si, position: wi });
        }
      }
    }
    if (positions.length === 0) return { ...entry, positions: entry.positions?.length ? entry.positions : [] };
    return { ...entry, positions };
  });
}

export function insertVocabularyAtSortedGap(
  list: VocabularyEntry[],
  sorted: VocabularyEntry[],
  showInputAt: number | null,
  newItem: VocabularyEntry
): VocabularyEntry[] {
  if (showInputAt === null || showInputAt === undefined) return [...list, newItem];
  if (showInputAt === 0) {
    const first = sorted[0];
    if (!first) return [newItem, ...list];
    const oi = list.indexOf(first);
    if (oi < 0) return [newItem, ...list];
    const nl = [...list];
    nl.splice(oi, 0, newItem);
    return nl;
  }
  const before = sorted[showInputAt - 1];
  if (!before) return [...list, newItem];
  const oi = list.indexOf(before);
  if (oi < 0) return [...list, newItem];
  const nl = [...list];
  nl.splice(oi + 1, 0, newItem);
  return nl;
}

export function mergeDuplicateVocabularyEntries(list: VocabularyEntry[]): VocabularyEntry[] {
  const byWord = new Map<string, VocabularyEntry>();
  for (const item of list) {
    const k = item.word.trim().toLowerCase();
    if (!k) continue;
    const prev = byWord.get(k);
    if (!prev) {
      byWord.set(k, {
        ...item,
        positions: item.positions?.length ? [...item.positions] : [],
      });
      continue;
    }
    const mergedPos = [...(prev.positions || []), ...(item.positions || [])];
    const seen = new Set<string>();
    const uniq = mergedPos.filter((p) => {
      const pk = `${p.sentence}:${p.position}`;
      if (seen.has(pk)) return false;
      seen.add(pk);
      return true;
    });
    const prevCefr = (prev.cefr && String(prev.cefr).trim()) || '';
    const itemCefr = (item.cefr && String(item.cefr).trim()) || '';
    byWord.set(k, {
      ...prev,
      meaning: (prev.meaning && prev.meaning.trim()) || item.meaning || '',
      partOfSpeech: prev.partOfSpeech || item.partOfSpeech,
      cefr: prevCefr || itemCefr,
      synonym: prev.synonym || item.synonym,
      antonym: prev.antonym || item.antonym,
      opposite: prev.opposite || item.opposite,
      positions: uniq,
    });
  }
  return Array.from(byWord.values());
}

function cleanText(text: string): string {
  return text
    .replace(/^["']|["']$/g, '')
    .replace(/^\d+\.\s*/, '')
    .replace(/\s*\d+\.\s*.*$/, '')
    .replace(/\s*\(.*?\)\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchLine(block: string, label: RegExp): string {
  const m = block.match(label);
  return m ? cleanText(m[1]) : '';
}

const CEFR_CANONICAL = new Set(VOCABULARY_CEFR_OPTIONS.filter(Boolean) as string[]);

/** AI·수동 입력 정규화 → '' 또는 A1~C2 */
export function normalizeCefrLevel(raw: string): string {
  const t = cleanText(raw).toUpperCase();
  if (!t || t === '없음' || t === 'NONE' || t === '-' || t === '미정' || t === 'N/A') return '';
  if (CEFR_CANONICAL.has(t)) return t;
  const m = t.match(/\b(A1|A2|B1|B2|C1|C2)\b/);
  return m ? m[1] : '';
}

export function parseWordBlock(block: string, item: Record<string, unknown>): Record<string, unknown> {
  const wordTypeMatch = block.match(/유형:\s*(.+?)(?=\n|$)/i);
  const partOfSpeechMatch = block.match(/품사:\s*(.+?)(?=\n|$)/i);
  const meaningMain = matchLine(block, /뜻:\s*(.+?)(?=\n|$)/i);
  const meaningExtra =
    matchLine(block, /부가뜻:\s*(.+?)(?=\n|$)/i) ||
    matchLine(block, /추가뜻:\s*(.+?)(?=\n|$)/i);
  /** 영어로 뜻이 같은 단어(동의어) — synonym 필드 */
  const englishSynonyms =
    matchLine(block, /영어유의어:\s*(.+?)(?=\n|$)/i) ||
    matchLine(block, /동의어\s*\(\s*영어\s*\)\s*:\s*(.+?)(?=\n|$)/i);
  /** 영어로 뜻이 반대인 단어(반의어) — antonym 필드 */
  const englishAntonyms =
    matchLine(block, /영어반의어:\s*(.+?)(?=\n|$)/i) ||
    matchLine(block, /반의어\s*\(\s*영어\s*\)\s*:\s*(.+?)(?=\n|$)/i);

  let wordType = wordTypeMatch ? cleanText(wordTypeMatch[1]) : '';
  let partOfSpeech = partOfSpeechMatch ? cleanText(partOfSpeechMatch[1]) : '';
  let meaning = meaningMain;
  if (meaningExtra && meaningExtra !== '없음' && meaningExtra !== 'none' && meaningExtra !== '-') {
    meaning = meaning ? `${meaning} · ${meaningExtra}` : meaningExtra;
  }

  let synonym = englishSynonyms;
  let antonym = englishAntonyms;
  let opposite = '';

  if (!synonym) {
    synonym = matchLine(block, /(?:^|\n)동의어:\s*(.+?)(?=\n|$)/i);
  }
  if (!antonym) {
    antonym = matchLine(block, /(?:^|\n)반의어:\s*(.+?)(?=\n|$)/i);
  }

  if (synonym === '없음' || synonym === 'none' || synonym === '-') synonym = '';
  if (antonym === '없음' || antonym === 'none' || antonym === '-') antonym = '';

  const cefrLine =
    matchLine(block, /CEFR\s*[:：]\s*(.+?)(?=\n|$)/i) ||
    matchLine(block, /난이도\s*[:：]\s*(.+?)(?=\n|$)/i);
  const parsedCefr = normalizeCefrLevel(cefrLine);
  const prevCefr = typeof item.cefr === 'string' ? item.cefr.trim() : '';

  return {
    ...item,
    wordType: wordType || item.wordType,
    partOfSpeech: partOfSpeech || item.partOfSpeech,
    meaning: meaning || item.meaning,
    cefr: parsedCefr || prevCefr,
    synonym: synonym || item.synonym,
    antonym: antonym || item.antonym,
    opposite: opposite || item.opposite,
  };
}

export { BATCH_SIZE };
