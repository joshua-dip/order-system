/**
 * 낱말배열 — 샘플 XLSX: KO 한 줄 + EN 단어를 ` / ` 로 셔플.
 * Question: 「한글 해석을 읽고 문맥에 맞도록 문장을 완성하시오.」
 */
import type { KitPassageInput, WordArrangeItem, WordArrangePassageResult } from './types';
import { seedFrom, shuffleArray, tokensForShuffle } from './tokenize';

export const WORD_ARRANGE_PROMPT = '한글 해석을 읽고 문맥에 맞도록 문장을 완성하시오.';

function shuffleWords(words: string[], seed: number): string[] {
  if (words.length <= 1) return [...words];
  let out = shuffleArray(words, seed);
  const same = out.join('\0') === words.join('\0');
  if (same && words.length > 1) {
    out = shuffleArray(words, seed ^ 0x9e3779b9);
  }
  /* 그래도 같으면 맨 앞·뒤 교환 */
  if (out.join('\0') === words.join('\0') && words.length > 1) {
    out = [...words];
    [out[0], out[out.length - 1]] = [out[out.length - 1], out[0]];
  }
  return out;
}

export function generateWordArrangePassage(passage: KitPassageInput): WordArrangePassageResult {
  const ens = passage.sentencesEn;
  const kos = passage.sentencesKo;
  const items: WordArrangeItem[] = [];
  const nSent = Math.max(ens.length, kos.length);

  for (let i = 0; i < nSent; i++) {
    const answer = (ens[i] ?? '').trim();
    const ko = (kos[i] ?? '').trim() || `(${i + 1})`;
    if (!answer) continue;
    const words = tokensForShuffle(answer);
    if (words.length < 2) {
      /* 단어 1개면 셔플 의미 없음 — 그래도 한 문항으로 */
      items.push({
        n: items.length + 1,
        ko,
        shuffled: words,
        answer,
      });
      continue;
    }
    const seed = seedFrom(passage.sourceKey, String(i), answer);
    items.push({
      n: items.length + 1,
      ko,
      shuffled: shuffleWords(words, seed),
      answer,
    });
  }

  return {
    sourceKey: passage.sourceKey,
    prompt: WORD_ARRANGE_PROMPT,
    items,
  };
}
