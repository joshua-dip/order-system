export const BAD_ENDING_WORDS = new Set([
  'do',
  'does',
  'did',
  'have',
  'has',
  'had',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'can',
  'will',
  'would',
  'should',
  'could',
  'may',
  'might',
  'must',
  'their',
  'his',
  'her',
  'its',
  'our',
  'your',
  'my',
  'this',
  'that',
  'these',
  'those',
  'the',
  'a',
  'an',
  'to',
  'of',
  'for',
  'with',
  'by',
  'from',
  'into',
  'through',
  'in',
  'on',
  'at',
  'as',
  'about',
  'and',
  'or',
  'but',
]);

export const AFTER_BAD_STARTS = [
  'and ',
  ', and ',
  'or ',
  ', or ',
  'that ',
  'which ',
  'who ',
  'whom ',
  'whose ',
  'where ',
  'when ',
] as const;

export function normalizeWhitespace(s: string): string {
  return s.split(/\s+/).join(' ').trim();
}

/** 첫 번째 일치만 치환 (일부 TS lib에서 `String#replace`의 count 인자 미지원) */
export function replaceFirst(haystack: string, needle: string, replacement: string): string {
  const i = haystack.indexOf(needle);
  if (i < 0) return haystack;
  return haystack.slice(0, i) + replacement + haystack.slice(i + needle.length);
}

export function findPhraseInText(text: string, phrase: string): string | null {
  const p = normalizeWhitespace(phrase).trim();
  if (!p) return null;
  const tNorm = normalizeWhitespace(text);
  const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(escaped, 'i').exec(tNorm);
  if (m) return m[0];
  const pWords = p.split(/\s+/);
  const tWords = tNorm.split(/\s+/);
  for (let i = 0; i <= tWords.length - pWords.length; i++) {
    const window = tWords.slice(i, i + pWords.length).join(' ');
    if (normalizeWhitespace(window).toLowerCase() === p.toLowerCase()) {
      return window;
    }
  }
  return null;
}

export function chunksRejoinToPhrase(chunks: string[], phrase: string): boolean {
  const rejoined = normalizeWhitespace(chunks.map((c) => c.trim()).join(' '));
  return rejoined.toLowerCase() === normalizeWhitespace(phrase).toLowerCase();
}

export function isSentenceEnd(text: string, i: number): boolean {
  if (i < 0 || i >= text.length || !'.!?'.includes(text[i])) return false;
  if (text[i] === '!' || text[i] === '?') {
    return i + 1 >= text.length || /\s/.test(text[i + 1]);
  }
  if (i >= 1 && /[a-zA-Z]/.test(text[i - 1]) && (i < 2 || !/[a-zA-Z]/.test(text[i - 2]))) {
    return false;
  }
  return i + 1 >= text.length || /\s/.test(text[i + 1]);
}

export function sentenceIndexOfPhrase(text: string, phrase: string): number | null {
  const exact = findPhraseInText(text, phrase);
  if (!exact || !text.includes(exact)) return null;
  const pos = text.indexOf(exact);
  if (pos < 0) return null;
  let n = 0;
  for (let i = 0; i < Math.min(pos, text.length); i++) {
    if (isSentenceEnd(text, i)) n += 1;
  }
  return n;
}

export function isTooEasyPhrase(phrase: string): boolean {
  if (!phrase || phrase.trim().split(/\s+/).length < 5) return false;
  const lower = phrase.trim().toLowerCase();
  if (/^(these|those)\s+\w+\s+(are|were)\s+/.test(lower)) return true;
  if (/^when\s+you\s+\w+/.test(lower)) return true;
  if (/^it\s+(is|was)\s+/.test(lower)) return true;
  if (/^the\s+\w+\s+(is|are|was|were)\s+/.test(lower)) return true;
  return false;
}

export function stripTrailingPunctuationForAnswer(s: string): string {
  if (!s) return s;
  let t = s.trim();
  while (t.length) {
    const last = t[t.length - 1];
    if (',;:"\''.includes(last)) {
      t = t.slice(0, -1).trimEnd();
    } else if (last === '—' || last === '─' || (last === '-' && t.length > 1 && /\s/.test(t[t.length - 2]))) {
      t = t.slice(0, -1).trimEnd();
    } else {
      break;
    }
  }
  return t.trim();
}

export function shuffledWordBox(chunks: string[]): string {
  const copy = chunks.map((c) => c.trim()).filter(Boolean);
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.join(' / ');
}

export function mergeColonChunks(chunks: string[]): string[] {
  if (!chunks.length) return chunks;
  const out: string[] = [];
  let i = 0;
  while (i < chunks.length) {
    const c = chunks[i].trim();
    if (c.endsWith(':') && i + 1 < chunks.length) {
      out.push(`${c} ${chunks[i + 1].trim()}`);
      i += 2;
    } else {
      out.push(c);
      i += 1;
    }
  }
  return out;
}

export function mergeArticleChunks(chunks: string[]): string[] {
  if (!chunks.length) return chunks;
  const out: string[] = [];
  let i = 0;
  while (i < chunks.length) {
    const c = chunks[i].trim();
    const low = c.toLowerCase();
    if ((low === 'the' || low === 'a' || low === 'an') && i + 1 < chunks.length) {
      out.push(`${c} ${chunks[i + 1].trim()}`);
      i += 2;
    } else {
      out.push(c);
      i += 1;
    }
  }
  return out;
}

const GRAMMAR_PATTERN =
  /\b(by|with|through|into|from)\s+[\w\s,()'-]+?(?=[.]\s|\s+[A-Z]|,\s|\s+and\s|\s+to\s|\s+that\s|$)/gi;

export function collectRuleBasedCandidatesEasy(
  text: string,
  isGood: (t: string, p: string) => boolean,
  splitPhraseToChunks: (p: string) => string[],
): { phrase: string; chunks: string[] }[] {
  const norm = normalizeWhitespace(text);
  const skipMarker = '__SKIP__';
  const candidates: { phrase: string; chunks: string[] }[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(GRAMMAR_PATTERN.source, 'gi');
  while ((m = re.exec(norm)) !== null) {
    let phrase = m[0].trim();
    if (phrase.includes(skipMarker)) continue;
    phrase = phrase.replace(/\s+\S*$/, '').trim();
    if (!phrase) continue;
    if (!isGood(text, phrase)) continue;
    const chunks = splitPhraseToChunks(phrase);
    if (chunks.length >= 4 && chunks.length <= 7 && chunksRejoinToPhrase(chunks, phrase)) {
      candidates.push({ phrase, chunks });
    }
  }
  const sentences = norm.split(/(?<=[.])\s+/);
  for (const sent0 of sentences) {
    const sent = sent0.trim();
    if (sent.includes(skipMarker) || !sent || sent.length < 35) continue;
    const words = sent.split(/\s+/);
    if (words.length < 6) continue;
    for (let start = 1; start < Math.max(2, words.length - 4); start++) {
      for (let span = 5; span < 8; span++) {
        const end = start + span;
        if (end > words.length) continue;
        const phrase = words.slice(start, end).join(' ').trim();
        if (!phrase || phrase.includes(skipMarker)) continue;
        if (!isGood(text, phrase)) continue;
        const chunks = splitPhraseToChunks(phrase);
        if (chunks.length >= 4 && chunks.length <= 7 && chunksRejoinToPhrase(chunks, phrase)) {
          candidates.push({ phrase, chunks });
        }
      }
    }
  }
  return candidates;
}

export function collectRuleBasedCandidatesHard(
  text: string,
  isGood: (t: string, p: string) => boolean,
): { phrase: string; chunks: string[] }[] {
  const norm = normalizeWhitespace(text);
  const skipMarker = '__SKIP__';
  const candidates: { phrase: string; chunks: string[] }[] = [];
  const sentences = norm.split(/(?<=[.])\s+/);
  for (const sent0 of sentences) {
    const sent = sent0.trim();
    if (sent.includes(skipMarker) || !sent || sent.length < 50) continue;
    const words = sent.split(/\s+/);
    if (words.length < 9) continue;
    for (let start = 1; start < Math.max(2, words.length - 7); start++) {
      for (let span = 8; span < 12; span++) {
        const end = start + span;
        if (end > words.length) continue;
        const phrase = words.slice(start, end).join(' ').trim();
        if (!phrase) continue;
        if (!isGood(text, phrase)) continue;
        const chunks = mergeColonChunks(phrase.split(/\s+/));
        if (chunksRejoinToPhrase(chunks, phrase)) {
          candidates.push({ phrase, chunks });
        }
      }
    }
  }
  return candidates;
}
