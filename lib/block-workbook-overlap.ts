/**
 * 블록 빈칸 워크북 — 블록 겹침 검출.
 *
 * 같은 문장 내에서 두 블록의 토큰 범위가 겹치면 통합 페이지에 동시에 빈칸 처리되어
 * 학생이 혼란스러울 수 있다. 이를 미리 경고하기 위한 검출기.
 */

import { SelectionBlock, SentenceTokenized } from './block-workbook-types';

export interface OverlapIssue {
  sentenceIdx: number;
  message: string;
  blocks: SelectionBlock[];
  severity: 'warn' | 'info';
}

const KIND_KO: Record<SelectionBlock['kind'], string> = {
  word: '단어',
  phrase: '구',
  sentence: '문장',
};

function rangesOverlap(a: SelectionBlock, b: SelectionBlock): boolean {
  return a.startTokenIdx <= b.endTokenIdx && b.startTokenIdx <= a.endTokenIdx;
}

function blockText(sent: SentenceTokenized, b: SelectionBlock): string {
  return sent.tokens.slice(b.startTokenIdx, b.endTokenIdx + 1).join(' ');
}

export function detectBlockOverlaps(
  sentences: SentenceTokenized[],
  blocks: SelectionBlock[],
): OverlapIssue[] {
  const issues: OverlapIssue[] = [];
  const bySentence = new Map<number, SelectionBlock[]>();
  for (const b of blocks) {
    const list = bySentence.get(b.sentenceIdx);
    if (list) list.push(b);
    else bySentence.set(b.sentenceIdx, [b]);
  }

  for (const [sIdx, list] of bySentence) {
    const sent = sentences.find(s => s.idx === sIdx);
    if (!sent || list.length < 2) continue;

    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (!rangesOverlap(a, b)) continue;

        // (1) 문장 블록 + 다른 블록 — 문장 영작 자리에 다른 빈칸이 같이 잡힘
        if (a.kind === 'sentence' || b.kind === 'sentence') {
          const non = a.kind === 'sentence' ? b : a;
          issues.push({
            sentenceIdx: sIdx,
            severity: 'warn',
            blocks: [a, b],
            message: `문장 ${sIdx + 1}: 문장 블록과 「${blockText(sent, non)}」(${KIND_KO[non.kind]})이(가) 겹칩니다 — 문장 영작/통합 페이지에서 동시 노출됩니다.`,
          });
          continue;
        }

        // (2) 한 블록이 다른 블록에 완전히 포함 — 같은 자리가 두 유형에 동시에 빈칸
        const aLen = a.endTokenIdx - a.startTokenIdx;
        const bLen = b.endTokenIdx - b.startTokenIdx;
        const inner = aLen <= bLen ? a : b;
        const outer = aLen <= bLen ? b : a;
        const innerInOuter =
          inner.startTokenIdx >= outer.startTokenIdx &&
          inner.endTokenIdx <= outer.endTokenIdx;
        if (innerInOuter) {
          issues.push({
            sentenceIdx: sIdx,
            severity: 'warn',
            blocks: [inner, outer],
            message: `문장 ${sIdx + 1}: 「${blockText(sent, inner)}」(${KIND_KO[inner.kind]})이(가) 「${blockText(sent, outer)}」(${KIND_KO[outer.kind]}) 안에 포함됩니다 — 같은 자리가 두 유형에 동시에 빈칸 처리됩니다.`,
          });
          continue;
        }

        // (3) 부분 겹침 (구↔구, 구↔단어 등)
        issues.push({
          sentenceIdx: sIdx,
          severity: 'warn',
          blocks: [a, b],
          message: `문장 ${sIdx + 1}: 「${blockText(sent, a)}」(${KIND_KO[a.kind]})와(과) 「${blockText(sent, b)}」(${KIND_KO[b.kind]})의 범위가 부분 겹칩니다.`,
        });
      }
    }
  }

  return issues;
}
