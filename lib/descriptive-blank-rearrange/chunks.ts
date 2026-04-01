import { normalizeWhitespace } from './utils';

export function phraseTo4To6Chunks(phrase: string): string[] {
  const words = phrase.trim().split(/\s+/);
  const n = words.length;
  if (n <= 4) return [...words];
  if (n <= 6) return [...words];
  const k = Math.min(6, Math.max(4, Math.floor((n + 2) / 2)));
  let size = Math.floor(n / k);
  const rem = n % k;
  const out: string[] = [];
  let i = 0;
  for (let j = 0; j < k; j++) {
    const take = size + (j < rem ? 1 : 0);
    out.push(words.slice(i, i + take).join(' '));
    i += take;
  }
  return out;
}

export function splitPhraseToChunks(phrase: string): string[] {
  phrase = normalizeWhitespace(phrase);
  const lower = phrase.toLowerCase();
  const seps = [' into ', ' by ', ' with ', ' through ', ' from '] as const;

  for (const sep of seps) {
    if (!lower.includes(sep)) continue;
    const idx = lower.indexOf(sep);
    const left = phrase.slice(0, idx).trim();
    const right = phrase.slice(idx + sep.length).trim();
    if (!right) continue;
    const midSep = phrase.slice(idx, idx + sep.length).trim();
    const leftChunks: string[] = [];
    if (left) {
      let rest = left;
      const innerSeps = [' by ', ' with ', ' turning ', ' using ', ' through '] as const;
      for (const sep2 of innerSeps) {
        const rl = rest.toLowerCase();
        if (!rl.includes(sep2)) continue;
        const idx2 = rl.indexOf(sep2);
        const before = rest.slice(0, idx2).trim();
        const mid = rest.slice(idx2, idx2 + sep2.length).trim();
        const after = rest.slice(idx2 + sep2.length).trim();
        if (before) leftChunks.push(before);
        leftChunks.push(mid);
        rest = after;
      }
      if (rest) leftChunks.push(rest);
      if (leftChunks.length === 0) leftChunks.push(left);
    }
    let chunks = [...leftChunks.filter(Boolean), midSep, right].filter(Boolean);
    if (chunks.length >= 4 && chunks.length <= 7) return chunks;
  }

  const ing = /\s+(\w+ing)\s+/i.exec(phrase);
  let chunks: string[] = [];
  if (ing && ing.index !== undefined) {
    const pos = ing.index;
    const a = phrase.slice(0, pos).trim();
    const b = phrase.slice(pos).trim();
    if (a && b) chunks = [a, ing[1], b].filter(Boolean);
  }
  if (chunks.length >= 4 && chunks.length <= 7) return chunks;

  const words = phrase.split(/\s+/);
  if (words.length <= 6) return words;
  const n = Math.min(6, Math.max(4, Math.floor((words.length + 2) / 3)));
  const size = Math.floor(words.length / n);
  const out: string[] = [];
  let i = 0;
  for (let k = 0; k < n; k++) {
    const take = k < n - 1 ? size : words.length - i;
    out.push(words.slice(i, i + take).join(' '));
    i += take;
  }
  return out;
}
