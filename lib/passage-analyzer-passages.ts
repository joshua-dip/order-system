import type { PassageStateStored, VocabularyEntry } from '@/lib/passage-analyzer-types';

function pickVocabularyListFromSaved(base: PassageStateStored, saved: PassageStateStored): VocabularyEntry[] {
  const s = saved as unknown as Record<string, unknown>;
  if (Array.isArray(s.vocabularyList)) return s.vocabularyList as VocabularyEntry[];
  /** 레거시 키 */
  if (Array.isArray(s.vocabulary)) return s.vocabulary as VocabularyEntry[];
  return base.vocabularyList;
}

/** passages 문서의 content → 분석용 영문 문장·한글 문장 (원문은 DB passages 전용) */
export function deriveSentencesFromPassageContent(content: Record<string, unknown> | undefined | null): {
  sentences: string[];
  koreanSentences: string[];
} {
  const c = content || {};
  const en = Array.isArray(c.sentences_en) ? (c.sentences_en as unknown[]).map(String) : [];
  const sentences =
    en.length > 0
      ? en.map((s) => s.trim()).filter(Boolean)
      : String(c.original || '')
          .split(/(?<=[.!?])\s+/)
          .map((s) => s.trim())
          .filter(Boolean);
  const koRaw = Array.isArray(c.sentences_ko) ? (c.sentences_ko as unknown[]).map(String) : [];
  const koreanSentences = sentences.map((_, i) => (koRaw[i] != null ? String(koRaw[i]).trim() : ''));
  return { sentences, koreanSentences };
}

function collapseSpaces(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function stripOuterQuotes(s: string): string {
  let t = collapseSpaces(s);
  while (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith('“') && t.endsWith('”')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    t = collapseSpaces(t.slice(1, -1));
  }
  return t;
}

function normMatch(s: string): string {
  return stripOuterQuotes(s)
    .toLowerCase()
    .replace(/[""`''´]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** 종합분석 `originalSentence`와 지문 문장 배열을 맞춰 주제문장 인덱스 후보를 찾는다. */
export function sentenceIndicesMatchingTopicQuote(sentences: string[], quoteRaw: string): number[] {
  const quote = stripOuterQuotes(quoteRaw);
  if (quote.length < 4) return [];

  const nq = normMatch(quote);
  if (nq.length < 4) return [];

  const out = new Set<number>();

  const overlaps = (a: string, b: string): boolean => {
    if (!a || !b) return false;
    if (a.length <= 12 && b.length <= 12) return a === b;
    return a.includes(b) || b.includes(a);
  };

  for (let i = 0; i < sentences.length; i++) {
    const ns = normMatch(sentences[i] || '');
    if (!ns) continue;
    if (overlaps(nq, ns)) out.add(i);
  }

  if (out.size === 0) {
    for (let i = 0; i < sentences.length - 1; i++) {
      const pair = normMatch(`${sentences[i] || ''} ${sentences[i + 1] || ''}`);
      if (pair.length >= 8 && overlaps(nq, pair)) {
        out.add(i);
        out.add(i + 1);
        break;
      }
    }
  }

  return Array.from(out).sort((a, b) => a - b);
}

/** 저장본을 얹되, 영·한 문장은 항상 passages 기준 유지 */
export function mergeSavedOntoPassagesBase(
  base: PassageStateStored,
  saved: PassageStateStored | undefined | null
): PassageStateStored {
  if (!saved) return base;
  const { sentences, koreanSentences } = base;
  const vocabularyList = pickVocabularyListFromSaved(base, saved);
  return {
    ...base,
    ...saved,
    sentences,
    koreanSentences,
    vocabularyList,
  };
}
