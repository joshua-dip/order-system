/**
 * 단어 관리 — 공용 타입/파서 (서버·클라이언트 공용, DB 의존 없음).
 * 단어장은 단어 항목 배열. 편집은 한 줄에 "단어 | 뜻 | 예문(선택)".
 */
export interface WordItem {
  w: string; // 단어
  m: string; // 뜻
  ex?: string; // 예문(선택)
}

/** 줄단위 "단어 | 뜻 | 예문" → WordItem[]. */
export function parseWordLines(text: string | undefined): WordItem[] {
  return (text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const p = l.split('|').map((s) => s.trim());
      const item: WordItem = { w: p[0] || '', m: p[1] || '' };
      if (p[2]) item.ex = p[2];
      return item;
    })
    .filter((x) => x.w);
}

/** WordItem[] → 편집용 줄단위 텍스트. */
export function wordsToText(words: WordItem[] | undefined): string {
  return (words || [])
    .map((x) => {
      const parts = [x.w, x.m];
      if (x.ex) parts.push(x.ex);
      return parts.join(' | ');
    })
    .join('\n');
}

export const WORDSET_PRINT_MODES = ['전체', '영→한 시험', '한→영 시험'] as const;
export type WordsetPrintMode = (typeof WORDSET_PRINT_MODES)[number];
