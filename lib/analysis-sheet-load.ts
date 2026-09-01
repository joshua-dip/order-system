/**
 * next-order 저장분 → 분석지 조판 입력 (라우트·CLI 공용).
 *
 * 두 가지를 흡수한다.
 *  1. 단어 키 — 이쪽 분석기는 "si:wi", 조판기(리체움 이식본)는 "si-wi".
 *  2. 라벨 — 이쪽 source_key 는 "Lesson 2. The Global Reach … 본문1" 처럼
 *     챕터 서술이 통째로 들어 있어, 그대로 번호에 넣으면 목차에서 잘린다.
 *     선택 지문들이 공유하는 접두사를 강(chapter)으로 분리해 번호를 짧게 만든다.
 */
import type { SheetPassage } from './analysis-sheet-html';

export function toSheetState(main: Record<string, any>): Record<string, any> {
  const conv = (arr: unknown) =>
    (Array.isArray(arr) ? arr : []).map((k) => String(k).replace(':', '-'));
  return {
    ...main,
    grammarSelectedWords: conv(main.grammarSelectedWords),
    contextSelectedWords: conv(main.contextSelectedWords),
  };
}

export interface SheetPassageSource {
  textbook: string;
  sourceKey: string;
  /** passages.page_label ?? page */
  pageLabel?: string;
  main: Record<string, any>;
}

/** 단어 경계 기준 공통 접두사. 전체가 접두사인 라벨이 있으면 한 단어 물려 준다. */
function commonTokenPrefix(labels: string[]): string {
  if (labels.length < 2) return '';
  const tokLists = labels.map((l) => l.split(/\s+/));
  const first = tokLists[0];
  let n = 0;
  while (
    n < first.length &&
    tokLists.every((t) => t.length > n && t[n] === first[n])
  ) n += 1;
  /* 남는 토큰이 없는 라벨이 생기면 마지막 토큰은 번호로 돌려준다. */
  while (n > 0 && tokLists.some((t) => t.length <= n)) n -= 1;
  return first.slice(0, n).join(' ');
}

export function buildSheetPassages(sources: SheetPassageSource[]): SheetPassage[] {
  const stripped = sources.map((s) => {
    let label = String(s.sourceKey ?? '').trim();
    const tb = String(s.textbook ?? '').trim();
    if (tb && label.startsWith(tb)) label = label.slice(tb.length).trim();
    return { ...s, label };
  });
  const chapter = commonTokenPrefix(stripped.map((s) => s.label));
  return stripped.map((s) => {
    const page = String(s.pageLabel ?? '').trim();
    return {
      교재명: s.textbook,
      강: chapter || undefined,
      번호: chapter ? s.label.slice(chapter.length).trim() : s.label,
      페이지: page ? (page.startsWith('p') ? page : `p${page}`) : undefined,
      state: toSheetState(s.main),
    };
  });
}
