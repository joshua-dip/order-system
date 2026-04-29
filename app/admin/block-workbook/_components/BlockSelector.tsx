'use client';

/**
 * 토큰 단위 블록 선택 UI.
 *
 * - 클릭 토글: 토큰 클릭 → 선택 추가/해제
 * - 드래그 범위: 같은 문장 내 mousedown→mouseover→mouseup 으로 연속 토큰 일괄 선택
 *   - Shift+드래그면 기존 선택에 추가, 그냥 드래그면 새로 시작
 *   - 마우스 업 위치가 시작점과 같으면 단순 클릭으로 처리
 * - 「문장 통째 선택」 버튼: 문장의 모든 토큰을 「문장 블록」으로 표시
 * - 모바일: pointer 이벤트로 동일 처리 (touch 도 pointer 로 흘러옴)
 *
 * 부모는 selection state 와 setter 만 넘기면 된다. 토큰화 결과(SentenceTokenized[])
 * 는 부모가 미리 만들어 전달.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BlockKind,
  SelectionBlock,
  SentenceTokenized,
} from '@/lib/block-workbook-types';

interface BlockSelectorProps {
  sentences: SentenceTokenized[];
  blocks: SelectionBlock[];
  onChangeBlocks: (next: SelectionBlock[]) => void;
}

interface DragState {
  sentenceIdx: number;
  startTokenIdx: number;
  currentTokenIdx: number;
  shift: boolean;
}

/** 블록 안에 토큰 (s,t) 가 들어있는지 */
function tokenInBlock(b: SelectionBlock, s: number, t: number): boolean {
  return b.sentenceIdx === s && t >= b.startTokenIdx && t <= b.endTokenIdx;
}

/** 단일 토큰 블록을 토글. 기존에 같은 위치 단어 블록이 있으면 제거, 없으면 추가. */
function toggleSingleToken(blocks: SelectionBlock[], s: number, t: number): SelectionBlock[] {
  const exact = blocks.find(b => b.sentenceIdx === s && b.startTokenIdx === t && b.endTokenIdx === t);
  if (exact) return blocks.filter(b => b !== exact);
  // 다른 블록(구·문장)이 이 토큰을 덮고 있으면 그 블록을 제거하고 단일 블록으로
  const covering = blocks.filter(b => tokenInBlock(b, s, t));
  const without = blocks.filter(b => !covering.includes(b));
  return [...without, { sentenceIdx: s, startTokenIdx: t, endTokenIdx: t, kind: 'word' }];
}

/** 드래그 결과로 블록 추가. start==end 면 단일 토글, 아니면 phrase·sentence 블록. */
function applyDragRange(
  prev: SelectionBlock[],
  s: number,
  startT: number,
  endT: number,
  totalTokens: number,
  shift: boolean,
): SelectionBlock[] {
  const lo = Math.min(startT, endT);
  const hi = Math.max(startT, endT);

  if (lo === hi) {
    // 단순 클릭과 동일
    return toggleSingleToken(prev, s, lo);
  }

  const isWholeSentence = lo === 0 && hi === totalTokens - 1;
  const kind: BlockKind = isWholeSentence ? 'sentence' : 'phrase';

  // 기존에 동일 범위가 있으면 제거 (토글)
  const exact = prev.find(
    b => b.sentenceIdx === s && b.startTokenIdx === lo && b.endTokenIdx === hi,
  );
  if (exact) return prev.filter(b => b !== exact);

  let base = prev;
  if (!shift) {
    // shift 가 아니면 그 문장의 기존 블록 중 이 범위와 겹치는 것을 제거
    base = prev.filter(b => {
      if (b.sentenceIdx !== s) return true;
      const overlap = !(b.endTokenIdx < lo || b.startTokenIdx > hi);
      return !overlap;
    });
  }
  return [...base, { sentenceIdx: s, startTokenIdx: lo, endTokenIdx: hi, kind }];
}

/** 한 문장 통째 토글. 같은 sentence 블록이 있으면 제거. */
function toggleWholeSentence(blocks: SelectionBlock[], s: number, totalTokens: number): SelectionBlock[] {
  const existing = blocks.find(
    b => b.sentenceIdx === s && b.kind === 'sentence' && b.startTokenIdx === 0 && b.endTokenIdx === totalTokens - 1,
  );
  if (existing) return blocks.filter(b => b !== existing);
  // 그 문장의 다른 블록은 모두 제거하고 sentence 블록 1개만 추가
  const without = blocks.filter(b => b.sentenceIdx !== s);
  return [...without, { sentenceIdx: s, startTokenIdx: 0, endTokenIdx: totalTokens - 1, kind: 'sentence' }];
}

export default function BlockSelector({ sentences, blocks, onChangeBlocks }: BlockSelectorProps) {
  const [drag, setDrag] = useState<DragState | null>(null);
  /** 마우스다운 → 같은 토큰에서 마우스업이면 클릭으로 보고 단순 토글. */
  const dragMovedRef = useRef(false);

  const isTokenSelected = useCallback(
    (s: number, t: number, kind?: BlockKind) => {
      return blocks.some(b => tokenInBlock(b, s, t) && (!kind || b.kind === kind));
    },
    [blocks],
  );

  const isInActiveDrag = useCallback(
    (s: number, t: number) => {
      if (!drag || drag.sentenceIdx !== s) return false;
      const lo = Math.min(drag.startTokenIdx, drag.currentTokenIdx);
      const hi = Math.max(drag.startTokenIdx, drag.currentTokenIdx);
      return t >= lo && t <= hi;
    },
    [drag],
  );

  /** mouseup 글로벌 — 드래그 종료 처리. */
  useEffect(() => {
    if (!drag) return;
    const handleUp = () => {
      const { sentenceIdx, startTokenIdx, currentTokenIdx, shift } = drag;
      const sent = sentences.find(s => s.idx === sentenceIdx);
      const total = sent?.tokens.length ?? 0;
      if (dragMovedRef.current && total > 0) {
        onChangeBlocks(applyDragRange(blocks, sentenceIdx, startTokenIdx, currentTokenIdx, total, shift));
      } else {
        // 안 움직였으면 단순 클릭 = 단일 토글
        onChangeBlocks(toggleSingleToken(blocks, sentenceIdx, startTokenIdx));
      }
      setDrag(null);
      dragMovedRef.current = false;
    };
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [drag, blocks, sentences, onChangeBlocks]);

  const handlePointerDown = (s: number, t: number, e: React.PointerEvent) => {
    e.preventDefault();
    dragMovedRef.current = false;
    setDrag({ sentenceIdx: s, startTokenIdx: t, currentTokenIdx: t, shift: e.shiftKey });
  };

  const handlePointerEnter = (s: number, t: number) => {
    if (!drag || drag.sentenceIdx !== s) return;
    if (t !== drag.currentTokenIdx) dragMovedRef.current = true;
    setDrag(d => (d ? { ...d, currentTokenIdx: t } : d));
  };

  return (
    <div className="space-y-3 select-none">
      {sentences.map(sent => {
        const sentenceBlock = blocks.find(
          b => b.sentenceIdx === sent.idx && b.kind === 'sentence',
        );
        return (
          <div key={sent.idx} className="flex items-start gap-2 group">
            <button
              type="button"
              onClick={() => onChangeBlocks(toggleWholeSentence(blocks, sent.idx, sent.tokens.length))}
              className={`shrink-0 mt-0.5 w-6 h-6 rounded text-[11px] font-bold border transition-colors ${
                sentenceBlock
                  ? 'bg-amber-500 text-slate-900 border-amber-400'
                  : 'border-slate-600 text-slate-500 hover:bg-slate-700 hover:text-slate-200'
              }`}
              title="문장 통째로 영작 블록"
            >
              {sentenceBlock ? '문' : '＋'}
            </button>
            <div className="flex flex-wrap gap-1 leading-relaxed flex-1">
              {sent.tokens.map((tok, t) => {
                const inSentence = !!sentenceBlock;
                const inWord = isTokenSelected(sent.idx, t, 'word');
                const inPhrase = isTokenSelected(sent.idx, t, 'phrase');
                const inActiveDrag = isInActiveDrag(sent.idx, t);

                let cls = 'px-1.5 py-0.5 rounded text-sm cursor-pointer transition-colors border ';
                if (inSentence) cls += 'bg-amber-500/30 text-amber-100 border-amber-500/40';
                else if (inWord) cls += 'bg-emerald-500/30 text-emerald-100 border-emerald-500/40';
                else if (inPhrase) cls += 'bg-sky-500/30 text-sky-100 border-sky-500/40';
                else if (inActiveDrag) cls += 'bg-purple-500/30 text-purple-100 border-purple-500/40';
                else cls += 'border-transparent text-slate-200 hover:bg-slate-700/50';

                return (
                  <span
                    key={t}
                    className={cls}
                    onPointerDown={e => handlePointerDown(sent.idx, t, e)}
                    onPointerEnter={() => handlePointerEnter(sent.idx, t)}
                  >
                    {tok}
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
