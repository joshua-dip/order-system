import type { VocabularyEntry } from '@/lib/passage-analyzer-types';

const BATCH_SIZE = 12;

export type VocabularySortOrder = 'original' | 'alphabetical' | 'position';

export const VOCABULARY_WORD_TYPE_OPTIONS = ['word', 'phrase'] as const;

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
    byWord.set(k, {
      ...prev,
      meaning: (prev.meaning && prev.meaning.trim()) || item.meaning || '',
      partOfSpeech: prev.partOfSpeech || item.partOfSpeech,
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

export function parseWordBlock(block: string, item: Record<string, unknown>): Record<string, unknown> {
  const wordTypeMatch = block.match(/유형:\s*(.+?)(?=\n|$)/i);
  const partOfSpeechMatch = block.match(/품사:\s*(.+?)(?=\n|$)/i);
  const meaningMatch = block.match(/뜻:\s*(.+?)(?=\n|$)/i);
  const synonymMatch = block.match(/추가뜻:\s*(.+?)(?=\n|$)/i);
  const antonymMatch = block.match(/동의어:\s*(.+?)(?=\n|$)/i);
  const oppositeMatch = block.match(/반의어:\s*(.+?)(?=\n|$)/i);

  let wordType = wordTypeMatch ? cleanText(wordTypeMatch[1]) : '';
  let partOfSpeech = partOfSpeechMatch ? cleanText(partOfSpeechMatch[1]) : '';
  let meaning = meaningMatch ? cleanText(meaningMatch[1]) : '';
  let synonym = synonymMatch ? cleanText(synonymMatch[1]) : '';
  let antonym = antonymMatch ? cleanText(antonymMatch[1]) : '';
  let opposite = oppositeMatch ? cleanText(oppositeMatch[1]) : '';

  if (antonym === '없음' || antonym === 'none' || antonym === '-') antonym = '';
  if (opposite === '없음' || opposite === 'none' || opposite === '-') opposite = '';

  return {
    ...item,
    wordType: wordType || item.wordType,
    partOfSpeech: partOfSpeech || item.partOfSpeech,
    meaning: meaning || item.meaning,
    synonym: synonym || item.synonym,
    antonym: antonym || item.antonym,
    opposite: opposite || item.opposite,
  };
}

export { BATCH_SIZE };
