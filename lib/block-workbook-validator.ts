/**
 * 블록 빈칸 워크북 — save 입력 정합성 검증.
 *
 * cc:block-workbook CLI 의 save 단계에서 호출. /admin/block-workbook 페이지
 * 의 클라이언트 빌드는 UI 가 자체적으로 정합 보장하므로 호출 안 함.
 *
 * errors  — 저장 거부 사유 (정량적 불일치)
 * warnings — 권장 위반 (저장은 가능). --force 로 errors 도 모두 warnings 격하 가능.
 */

import {
  BlockUse,
  BlockWorkbookSelection,
  ELIGIBLE_USES_BY_KIND,
  SelectionBlock,
  WorkbookKind,
  blockUseIncludes,
  sentenceUsesIncludes,
} from './block-workbook-types';
import { detectBlockOverlaps } from './block-workbook-overlap';

export interface BlockWorkbookValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface BlockWorkbookSaveLikeInput {
  passageId?: string;
  textbook?: string;
  sourceKey?: string;
  title?: string;
  folder?: string;
  selection?: BlockWorkbookSelection;
  types?: WorkbookKind[];
}

const VALID_KINDS = new Set<SelectionBlock['kind']>(['word', 'phrase', 'sentence']);
// E·F 는 옛 데이터 호환을 위해 허용. UI·렌더러는 사용 안 함 (E 제거 / F 어법공략 워크북 분리).
const VALID_TYPES = new Set<WorkbookKind>(['A', 'B', 'C', 'D', 'I', 'E', 'F']);

export function validateBlockWorkbookInput(
  input: BlockWorkbookSaveLikeInput,
): BlockWorkbookValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // ── 메타 ─────────────────────────────────────────────────────────────────
  if (!input.title || !input.title.trim()) {
    errors.push('title 이 비어 있습니다.');
  }
  if (!input.textbook || !input.textbook.trim()) {
    errors.push('textbook 이 비어 있습니다.');
  }
  if (!input.sourceKey || !input.sourceKey.trim()) {
    errors.push('sourceKey 가 비어 있습니다.');
  }

  // ── types ───────────────────────────────────────────────────────────────
  const types = input.types ?? [];
  if (!Array.isArray(types) || types.length === 0) {
    errors.push('types 배열이 비어 있습니다 (A~F 중 1개 이상 필요).');
  } else {
    const invalid = types.filter(t => !VALID_TYPES.has(t));
    if (invalid.length) errors.push(`알 수 없는 type: ${invalid.join(', ')}`);
  }

  // ── selection ───────────────────────────────────────────────────────────
  const sel = input.selection;
  if (!sel || typeof sel !== 'object') {
    errors.push('selection 이 비어 있습니다.');
    return { valid: false, errors, warnings };
  }
  if (!Array.isArray(sel.sentences) || sel.sentences.length === 0) {
    errors.push('selection.sentences 가 비어 있습니다.');
  }
  if (!Array.isArray(sel.blocks)) {
    errors.push('selection.blocks 가 배열이 아닙니다.');
    return { valid: errors.length === 0, errors, warnings };
  }
  if (sel.blocks.length === 0) {
    errors.push('selection.blocks 가 비어 있습니다 (블록 1개 이상 필요).');
  }

  // ── 블록 인덱스 정합 ────────────────────────────────────────────────────
  for (const [i, b] of sel.blocks.entries()) {
    const tag = `blocks[${i}]`;
    if (!VALID_KINDS.has(b.kind)) {
      errors.push(`${tag}: 알 수 없는 kind="${b.kind}"`);
      continue;
    }
    const sent = sel.sentences.find(s => s.idx === b.sentenceIdx);
    if (!sent) {
      errors.push(`${tag}: sentenceIdx=${b.sentenceIdx} 에 해당하는 문장이 sentences 에 없습니다.`);
      continue;
    }
    const total = sent.tokens.length;
    if (b.startTokenIdx < 0 || b.startTokenIdx >= total) {
      errors.push(`${tag}: startTokenIdx=${b.startTokenIdx} 가 범위 밖 (0..${total - 1}).`);
    }
    if (b.endTokenIdx < 0 || b.endTokenIdx >= total) {
      errors.push(`${tag}: endTokenIdx=${b.endTokenIdx} 가 범위 밖 (0..${total - 1}).`);
    }
    if (b.startTokenIdx > b.endTokenIdx) {
      errors.push(`${tag}: startTokenIdx(${b.startTokenIdx}) > endTokenIdx(${b.endTokenIdx})`);
    }

    // kind 별 길이 규칙
    const len = b.endTokenIdx - b.startTokenIdx + 1;
    if (b.kind === 'word' && len !== 1) {
      errors.push(`${tag}: kind=word 는 길이 1 토큰이어야 합니다 (현재 ${len}).`);
    }
    if (b.kind === 'sentence' && (b.startTokenIdx !== 0 || b.endTokenIdx !== total - 1)) {
      errors.push(
        `${tag}: kind=sentence 는 문장 전체 (0..${total - 1}) 여야 합니다 (현재 ${b.startTokenIdx}..${b.endTokenIdx}).`,
      );
    }
    if (b.kind === 'phrase' && len < 2) {
      errors.push(`${tag}: kind=phrase 는 길이 2 이상이어야 합니다 (현재 ${len}).`);
    }
    if (b.kind === 'phrase' && len > 6) {
      warnings.push(`${tag}: phrase 길이 ${len} — 권장 2~5 단어를 벗어났습니다.`);
    }

    // uses 필드 검증 — kind 별 적격 use 만 허용
    if (b.uses !== undefined) {
      if (!Array.isArray(b.uses)) {
        errors.push(`${tag}: uses 는 배열이어야 합니다.`);
      } else {
        const eligible = ELIGIBLE_USES_BY_KIND[b.kind];
        const all: BlockUse[] = ['A', 'B', 'C', 'D', 'E', 'F'];
        const unknown = b.uses.filter(u => !all.includes(u as BlockUse));
        if (unknown.length) errors.push(`${tag}: uses 에 알 수 없는 값 ${unknown.join(', ')} (허용: A, B, C, D, E, F)`);
        const inelig = b.uses.filter(u => all.includes(u as BlockUse) && !eligible.includes(u as BlockUse));
        if (inelig.length) {
          warnings.push(`${tag}: kind=${b.kind} 에 부적격한 use ${inelig.join(', ')} — 무시됩니다 (적격: ${eligible.join(', ')}).`);
        }
        if (b.uses.length === 0) warnings.push(`${tag}: uses 가 빈 배열입니다 — 이 블록은 어디에도 노출되지 않습니다.`);
      }
    }
  }

  // ── 블록 겹침 (overlap util 재사용) ─────────────────────────────────────
  if (sel.sentences && sel.blocks) {
    const overlaps = detectBlockOverlaps(sel.sentences, sel.blocks);
    for (const issue of overlaps) {
      // 페이지 UI 는 warning 으로만 잡지만 CLI 저장에서는 errors 로 격상
      // (자동화에선 모호함을 일찍 잡는 게 안전)
      errors.push(`overlap: ${issue.message}`);
    }
  }

  // ── types ↔ 블록 정합 ───────────────────────────────────────────────────
  const has = (k: SelectionBlock['kind']) => sel.blocks.some(b => b.kind === k);
  if (types.includes('A') && !has('word')) {
    warnings.push('types 에 A 가 있지만 word 블록이 없습니다 — A 본문이 마스킹 없는 원문으로 출력됩니다.');
  }
  if (types.includes('B') && !has('phrase')) {
    warnings.push('types 에 B 가 있지만 phrase 블록이 없습니다.');
  }
  const hasSentenceFor = (use: 'C' | 'D') =>
    sel.blocks.some(b => b.kind === 'sentence' && blockUseIncludes(b, use));
  if (types.includes('C') && !hasSentenceFor('C')) {
    warnings.push('types 에 C 가 있지만 C 용도 sentence 블록이 없습니다.');
  }
  if (types.includes('D') && !hasSentenceFor('D')) {
    warnings.push('types 에 D 가 있지만 D 용도 sentence 블록이 없습니다.');
  }
  if (types.includes('I')) {
    const iBlocks = sel.blocks.filter(
      b => (b.kind === 'word' || b.kind === 'phrase') && blockUseIncludes(b, 'I'),
    );
    if (iBlocks.length === 0) {
      warnings.push('types 에 I 가 있지만 I 용도 word/phrase 블록이 없습니다.');
    } else {
      const lowDistractors = iBlocks.filter(b => (b.distractors ?? []).filter(s => s.trim()).length < 4);
      if (lowDistractors.length) {
        warnings.push(`I 접속사 빈칸: ${lowDistractors.length}개 블록의 distractor 가 4개 미만 — 부족분은 기본 풀에서 자동 채움.`);
      }
    }
  }
  if (types.includes('E') || types.includes('F')) {
    warnings.push('E (핵심 표현 정리) 와 F (어법 변형) 는 더 이상 블록 빈칸 워크북에서 출력되지 않습니다 — 어법은 「어법공략 워크북」 탭으로 분리됨.');
  }

  return { valid: errors.length === 0, errors, warnings };
}
