/**
 * 영어 본문을 문장→토큰 단위로 자르는 단순 토크나이저.
 * 블록 워크북에서 부모가 한 번만 토큰화해 자식 컴포넌트에 넘긴다.
 */

import { SentenceTokenized } from './block-workbook-types';

/** 마침표/느낌표/물음표 뒤 공백으로 문장 분리. 인용 부호 단순 처리. */
function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z"'(\[])/)
    .map(s => s.trim())
    .filter(Boolean);
}

/** 한 문장 → 단어 단위 토큰. 구두점은 토큰 끝에 붙여 둠. */
function tokenizeSentence(sentence: string): string[] {
  return sentence
    .split(/\s+/)
    .map(s => s.trim())
    .filter(Boolean);
}

export function tokenizePassage(text: string): SentenceTokenized[] {
  const sentences = splitSentences(text);
  return sentences.map((s, idx) => ({ idx, text: s, tokens: tokenizeSentence(s) }));
}

/**
 * passages.content 객체에서 토큰화. sentences_en 이 있으면 그 배열을 그대로 사용해
 * sentences_ko 와 인덱스 정합을 보장. 없으면 original 을 split 하여 fallback.
 */
export function tokenizePassageFromContent(
  content: { original?: string; sentences_en?: unknown; sentences_ko?: unknown } | null | undefined,
): SentenceTokenized[] {
  const c = content ?? {};
  const enArr = Array.isArray(c.sentences_en)
    ? (c.sentences_en as unknown[]).map(v => String(v ?? '').trim()).filter(Boolean)
    : [];
  const koArr = Array.isArray(c.sentences_ko)
    ? (c.sentences_ko as unknown[]).map(v => String(v ?? '').trim())
    : [];
  const sentences = enArr.length > 0 ? enArr : splitSentences(String(c.original ?? ''));
  return sentences.map((s, idx) => ({
    idx,
    text: s,
    tokens: tokenizeSentence(s),
    korean: koArr[idx] || undefined,
  }));
}
