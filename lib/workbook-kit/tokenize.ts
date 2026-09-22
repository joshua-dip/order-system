/** 문장·토큰 유틸 — 낱말배열·빈칸 공통 */

const WORD_RE = /[A-Za-z]+(?:['’-][A-Za-z]+)*|[0-9]+(?:st|nd|rd|th)?|[^\sA-Za-z0-9]+/g;

export type Token = {
  raw: string;
  /** 소문자 lemma-ish (구두점 제거) */
  word: string;
  isWord: boolean;
};

export function tokenizeWords(sentence: string): Token[] {
  const out: Token[] = [];
  const s = sentence.trim();
  if (!s) return out;
  const matches = s.match(WORD_RE) ?? [];
  for (const raw of matches) {
    const word = raw.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
    const isWord = /[A-Za-z0-9]/.test(word);
    out.push({ raw, word, isWord });
  }
  return out;
}

/** 셔플용: 단어+붙은 구두점을 한 덩이 (샘플: process, / planned) */
export function tokensForShuffle(sentence: string): string[] {
  const parts = sentence
    .trim()
    .split(/\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts;
}

export function shuffleArray<T>(arr: T[], seed: number): T[] {
  const a = [...arr];
  let s = seed >>> 0 || 1;
  const rnd = () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function seedFrom(...parts: string[]): number {
  let h = 2166136261;
  const s = parts.join('\0');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function joinTokens(tokens: Token[]): string {
  let out = '';
  for (const t of tokens) {
    if (!out) {
      out = t.raw;
      continue;
    }
    if (/^[,.;:!?'"”)\]%]/.test(t.raw)) out += t.raw;
    else if (/^['"“(\[]/.test(t.raw) || /[-—–]$/.test(out)) out += t.raw;
    else out += ` ${t.raw}`;
  }
  return out.replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim();
}
