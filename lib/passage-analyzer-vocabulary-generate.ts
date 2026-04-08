import type { VocabularyEntry } from '@/lib/passage-analyzer-types';

/** PassageAnalyzerMain과 동일한 기본 영어 불용어 */
export const DEFAULT_ENGLISH_STOPWORDS = [
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'been',
  'by',
  'for',
  'from',
  'has',
  'he',
  'in',
  'is',
  'it',
  'its',
  'of',
  'on',
  'that',
  'the',
  'to',
  'was',
  'will',
  'with',
  'would',
  'you',
  'your',
  'have',
  'had',
  'do',
  'does',
  'did',
  'can',
  'could',
  'should',
  'may',
  'might',
  'must',
  'shall',
  'am',
  'were',
  'being',
  'ought',
  'i',
  'me',
  'my',
  'myself',
  'we',
  'our',
  'ours',
  'ourselves',
  'yours',
  'yourself',
  'yourselves',
  'him',
  'his',
  'himself',
  'she',
  'her',
  'hers',
  'herself',
  'itself',
  'they',
  'them',
  'their',
  'theirs',
  'themselves',
  'what',
  'which',
  'who',
  'whom',
  'this',
  'these',
  'those',
  'here',
  'there',
  'where',
  'when',
  'why',
  'how',
  'all',
  'any',
  'both',
  'each',
  'few',
  'more',
  'most',
  'other',
  'some',
  'such',
  'no',
  'nor',
  'not',
  'only',
  'own',
  'same',
  'so',
  'than',
  'too',
  'very',
  's',
  't',
  'll',
  've',
  're',
  'd',
  'm',
  'o',
  'because',
  'but',
  'or',
  'nor',
  'so',
  'if',
  'though',
  'although',
  'toward',
  'towards',
  'unless',
  'while',
  'yet',
  'thus',
  'hence',
  'st',
  'nd',
  'rd',
  'th',
  'also',
  'just',
  'about',
  'up',
  'out',
  'into',
  'over',
  'after',
  'before',
  'between',
  'under',
  'again',
  'then',
  'once',
  'during',
  'through',
  'down',
  'against',
  'until',
  'among',
  'etc',
] as const;

export function allStopWordsSet(custom: string[] | undefined): Set<string> {
  const s = new Set<string>(DEFAULT_ENGLISH_STOPWORDS);
  for (const w of custom || []) {
    const t = w.trim().toLowerCase();
    if (t) s.add(t);
  }
  return s;
}

const SINGULAR_EXCEPTIONS = new Set([
  'series', 'species', 'news', 'means', 'always', 'perhaps',
  'across', 'unless', 'whereas', 'besides', 'sometimes',
  'towards', 'this', 'thus', 'plus', 'minus', 'versus',
  'chaos', 'cosmos', 'yes', 'no', 'campus', 'bonus',
  'focus', 'status', 'virus', 'apparatus', 'consensus',
  'afterwards', 'always', 'sometimes', 'perhaps', 'its',
  'has', 'was', 'does', 'goes',
]);

/**
 * 영어 복수형/굴절형 → 기본형(단수) 변환.
 * 완벽하지는 않지만 일반적인 패턴을 처리합니다.
 */
export function toBaseForm(word: string): string {
  const lower = word.toLowerCase();
  if (lower.length <= 3) return word;

  if (SINGULAR_EXCEPTIONS.has(lower)) return word;

  if (
    lower.endsWith('ous') || lower.endsWith('ness') ||
    lower.endsWith('less') || lower.endsWith('sis') ||
    lower.endsWith('ics') || lower.endsWith('us') ||
    lower.endsWith('is')
  ) return word;

  if (!lower.endsWith('s')) return word;
  if (lower.endsWith('ss')) return word;
  if (word.endsWith("'s") || word.endsWith("'s")) return word;

  if (lower.endsWith('ies') && lower.length > 4) {
    return word.slice(0, -3) + 'y';
  }

  if (lower.endsWith('es') && lower.length > 3) {
    const stem = lower.slice(0, -2);
    if (stem.endsWith('ch') || stem.endsWith('sh') ||
        stem.endsWith('x') || stem.endsWith('z') ||
        stem.endsWith('ss')) {
      return word.slice(0, -2);
    }
    return word.slice(0, -1);
  }

  return word.slice(0, -1);
}

/**
 * 쉼표로 구분된 영어 단어 각각을 기본형으로 변환.
 */
export function toBaseFormList(csv: string): string {
  if (!csv.trim()) return csv;
  return csv
    .split(',')
    .map((w) => {
      const trimmed = w.trim();
      if (!trimmed || trimmed.includes(' ')) return w;
      const base = toBaseForm(trimmed);
      const leading = w.match(/^\s*/)?.[0] ?? '';
      return leading + base;
    })
    .join(',');
}

function guessPartOfSpeech(word: string): string {
  const isPhrase = word.includes(' ');
  if (isPhrase) {
    if (word.includes('to ') && word.split(' ').length <= 3) return 'v. phrase';
    if (word.endsWith('ly')) return 'adv. phrase';
    return 'phrase';
  }
  if (word.endsWith('ing') || word.endsWith('ed') || word.endsWith('s')) return 'v.';
  if (word.endsWith('ly')) return 'adv.';
  if (word.endsWith('tion') || word.endsWith('ness') || word.endsWith('ment')) return 'n.';
  if (word.endsWith('ful') || word.endsWith('less') || word.endsWith('able')) return 'adj.';
  return 'n.';
}

/* ── 고빈도 영어 숙어 사전 (수능·내신 빈출) ── */

const COMMON_PHRASES: readonly string[] = [
  // 연결·전환
  'in other words', 'on the other hand', 'as a result', 'in addition',
  'for example', 'for instance', 'in fact', 'as a matter of fact',
  'in contrast', 'on the contrary', 'by contrast', 'in particular',
  'in general', 'in short', 'in brief', 'in summary', 'in conclusion',
  'as well as', 'not only', 'rather than', 'other than',
  'such as', 'as long as', 'as far as', 'as soon as', 'as well',
  'so that', 'in order to', 'so as to',
  'even though', 'even if', 'as though', 'as if',
  // 전치사구·부사구
  'at first', 'at last', 'at least', 'at most', 'at once',
  'at the same time', 'at all', 'after all', 'above all',
  'by the way', 'by means of', 'by no means', 'by far',
  'in terms of', 'in spite of', 'in case of', 'in favor of',
  'in the meantime', 'in the end', 'in turn', 'in advance',
  'on behalf of', 'on purpose', 'on time', 'in time',
  'from time to time', 'little by little', 'side by side',
  'now and then', 'once in a while', 'all of a sudden',
  // 동사구
  'come up with', 'come across', 'come about', 'come true',
  'carry out', 'bring about', 'bring up', 'break down', 'break out',
  'figure out', 'find out', 'give up', 'give in', 'give rise to',
  'go on', 'go through', 'grow up', 'hang out',
  'keep up with', 'keep in mind', 'look after', 'look for',
  'look forward to', 'look into', 'look up', 'look up to',
  'make up', 'make sense', 'make sure', 'make use of',
  'pick up', 'point out', 'put off', 'put up with',
  'run into', 'run out of', 'set up', 'set off',
  'show up', 'stand for', 'stand out', 'take advantage of',
  'take care of', 'take for granted', 'take into account',
  'take part in', 'take place', 'take turns', 'take up',
  'think of', 'turn down', 'turn into', 'turn out',
  'used to', 'would rather', 'had better',
  // be + 형용사/분사 + 전치사
  'be able to', 'be about to', 'be likely to', 'be supposed to',
  'be willing to', 'be used to', 'be accustomed to',
  'be aware of', 'be capable of', 'be composed of',
  'be concerned about', 'be familiar with', 'be involved in',
  'be known for', 'be related to', 'be responsible for',
  'be associated with', 'be based on', 'be regarded as',
  // 기타
  'a number of', 'a variety of', 'a great deal of',
  'the number of', 'a series of', 'a kind of',
  'belong to', 'depend on', 'rely on', 'result in', 'result from',
  'consist of', 'contribute to', 'deal with', 'refer to',
  'lead to', 'respond to', 'apply to', 'adapt to', 'adjust to',
  'according to', 'due to', 'owing to', 'thanks to',
  'in spite of', 'regardless of', 'instead of',
  'with regard to', 'with respect to', 'compared to',
  'contrary to', 'prior to', 'subsequent to',
] as const;

interface PhraseTrieNode {
  children: Map<string, PhraseTrieNode>;
  phrase?: string;
}

function buildPhraseTrie(phrases: readonly string[]): PhraseTrieNode {
  const root: PhraseTrieNode = { children: new Map() };
  for (const phrase of phrases) {
    const words = phrase.toLowerCase().split(/\s+/);
    let node = root;
    for (const w of words) {
      if (!node.children.has(w)) node.children.set(w, { children: new Map() });
      node = node.children.get(w)!;
    }
    node.phrase = phrase;
  }
  return root;
}

const PHRASE_TRIE = buildPhraseTrie(COMMON_PHRASES);

function cleanToken(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z'-]/g, '');
  const alphaOnly = cleaned.replace(/[^a-zA-Z]/g, '');
  return (alphaOnly.length >= 2 && alphaOnly === alphaOnly.toUpperCase())
    ? cleaned
    : cleaned.toLowerCase();
}

/**
 * 지문 문장에서 고유 단어(위치 포함) 목록을 만든 뒤 불용어를 제외합니다.
 * 숙어 사전에 있는 multi-word phrase는 하나의 항목으로 묶습니다.
 */
export function buildVocabularyListFromSentences(
  sentences: string[],
  options: {
    customStopWords?: string[];
    sourcePassage?: string | number;
  } = {}
): VocabularyEntry[] {
  const custom = options.customStopWords || [];
  const stop = allStopWordsSet(custom);

  const wordPositions: { word: string; sentence: number; position: number }[] = [];
  const phraseUsedPositions = new Set<string>();

  sentences.forEach((sentence, sentenceIndex) => {
    const rawWords = sentence.split(/\s+/);
    const tokens = rawWords.map((rw) => cleanToken(rw));

    for (let wi = 0; wi < tokens.length; wi++) {
      const token = tokens[wi];
      if (!token || token.length <= 1) continue;

      let node = PHRASE_TRIE.children.get(token);
      if (node) {
        let best: { phrase: string; endIndex: number } | null = null;
        if (node.phrase) best = { phrase: node.phrase, endIndex: wi };
        let cursor = wi + 1;
        while (cursor < tokens.length) {
          const next = tokens[cursor];
          if (!next) break;
          const child: PhraseTrieNode | undefined = node.children.get(next);
          if (!child) break;
          node = child;
          if (node.phrase) best = { phrase: node.phrase, endIndex: cursor };
          cursor++;
        }
        if (best) {
          const posKey = `${sentenceIndex}:${wi}`;
          phraseUsedPositions.add(posKey);
          for (let k = wi; k <= best.endIndex; k++) {
            phraseUsedPositions.add(`${sentenceIndex}:${k}`);
          }
          wordPositions.push({ word: best.phrase, sentence: sentenceIndex, position: wi });
          wi = best.endIndex;
          continue;
        }
      }
    }

    rawWords.forEach((rawWord, wordIndex) => {
      if (phraseUsedPositions.has(`${sentenceIndex}:${wordIndex}`)) return;

      const word = tokens[wordIndex];
      if (!word || word.length <= 1 || /^\d+$/.test(word)) return;

      const alphaStart = rawWord.replace(/^[^A-Za-z]+/, '');
      if (
        wordIndex > 0 &&
        alphaStart.length > 0 &&
        /^[A-Z][a-z]{1,}/.test(alphaStart) &&
        !/^I'/.test(alphaStart)
      ) {
        return;
      }

      if (word === 'alone' && wordIndex > 0) {
        const prev = rawWords[wordIndex - 1].replace(/[^a-zA-Z]/g, '').toLowerCase();
        if (prev === 'let') return;
      }

      wordPositions.push({ word: toBaseForm(word), sentence: sentenceIndex, position: wordIndex });
    });
  });

  const totalWords = wordPositions.length;
  const wordMap = new Map<string, { sentence: number; position: number }[]>();

  for (const { word, sentence, position } of wordPositions) {
    if (!wordMap.has(word)) wordMap.set(word, []);
    wordMap.get(word)!.push({ sentence, position });
  }

  const uniqueWords = Array.from(wordMap.keys()).sort((a, b) => a.localeCompare(b));

  const withMeta = uniqueWords.map((word) => {
    const isPhrase = word.includes(' ');
    return {
      word,
      meaning: '',
      wordType: isPhrase ? 'phrase' : 'word',
      partOfSpeech: guessPartOfSpeech(word),
      cefr: '',
      synonym: '',
      antonym: '',
      opposite: '',
      positions: wordMap.get(word)!,
      totalWords,
      uniqueWords: uniqueWords.length,
      ...(options.sourcePassage != null ? { sourcePassage: options.sourcePassage } : {}),
    } satisfies VocabularyEntry;
  });

  return withMeta.filter((item) => !stop.has(item.word.toLowerCase().trim()));
}

export function filterVocabularyByStopwords(
  list: VocabularyEntry[],
  customStopWords?: string[]
): VocabularyEntry[] {
  const stop = allStopWordsSet(customStopWords);
  return list.filter((item) => !stop.has(item.word.toLowerCase().trim()));
}
