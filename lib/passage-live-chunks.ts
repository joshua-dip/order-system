/**
 * 수업 화면 — 브라우저·서버 공용 순수 함수(끊어읽기 나누기, 단어장을 문장에 붙이기).
 */
import type { VocabularyEntry } from '@/lib/passage-analyzer-types';

export type LiveVocab = { word: string; meaning: string; pos?: string; sentences: number[] };

const str = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');

/** 문장을 끊어읽기 위치로 나눈다 — breaks 의 i 는 「단어 i 뒤」. 단어 분리는 분석기와 같은 split(/\s+/). */
export function chunkSentence(sentence: string, breaks: readonly number[] | undefined): string[] {
  // 빈 토큰(겹공백)도 자리를 지켜야 분석기의 단어 번호와 맞는다
  const words = sentence.split(/\s+/);
  const cut = new Set((breaks ?? []).filter((b) => Number.isInteger(b) && b >= 0 && b < words.length - 1));
  const out: string[] = [];
  let cur: string[] = [];
  words.forEach((w, i) => {
    if (w) cur.push(w);
    if (cut.has(i) && cur.length) {
      out.push(cur.join(' '));
      cur = [];
    }
  });
  if (cur.length) out.push(cur.join(' '));
  return out;
}

/** 단어장 항목을 문장에 붙인다 — positions 가 있으면 그것, 없으면 그 단어가 나오는 문장. */
export function vocabularyBySentence(sentences: readonly string[], list: readonly VocabularyEntry[] | undefined): LiveVocab[] {
  const out: LiveVocab[] = [];
  for (const v of list ?? []) {
    const word = str(v?.word);
    const meaning = str(v?.meaning);
    if (!word || !meaning) continue;
    let idx = [...new Set((v.positions ?? []).map((p) => p?.sentence).filter((n): n is number => Number.isInteger(n) && n >= 0 && n < sentences.length))];
    if (idx.length === 0) {
      const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
      idx = sentences.map((s, i) => (re.test(s) ? i : -1)).filter((i) => i >= 0);
    }
    out.push({ word, meaning, pos: str(v.partOfSpeech) || undefined, sentences: idx });
  }
  return out;
}

