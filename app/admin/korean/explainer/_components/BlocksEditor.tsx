'use client';

import { useState } from 'react';
import type { Block, BlockType } from '@/lib/korean-explainer/types';
import {
  ALL_BLOCK_TYPES,
  NON_FICTION_PRIORITY_BLOCKS,
  LITERATURE_ONLY_BLOCKS,
} from '@/lib/korean-explainer/types';
import BlockEditorRouter from './blocks/BlockEditorRouter';

interface BlocksEditorProps {
  blocks: Block[];
  onChange: (next: Block[]) => void;
  /** cover 블록 신규 추가 시 메타에서 prefill (사용자 편의). */
  coverPrefill?: { exam_title: string; set_range: string; genre: string; work_title: string; show_subtitle: boolean };
}

const BLOCK_LABEL: Record<BlockType, string> = {
  cover: 'cover · 표지',
  section_header: 'section_header · 섹션',
  info_box: 'info_box · 기본 정보',
  paragraph_table: 'paragraph_table · 문단 표',
  timeline: 'timeline · 사건 흐름',
  character_grid: 'character_grid · 인물',
  compare_2col: 'compare_2col · 2단 대조',
  concept_grid: 'concept_grid · 개념 카드',
  process_diagram: 'process_diagram · 과정 도해',
  emotion_flow: 'emotion_flow · 정서 3단계',
  sijo_box: 'sijo_box · 시조 풀이',
  gist_box: 'gist_box · 한 줄 요지',
  question: 'question · 문제 해설',
};

function makeDefaultData(type: BlockType): Block {
  switch (type) {
    case 'cover':
      return { type, data: { exam_title: '', set_range: '', genre: '', work_title: '', show_subtitle: false } };
    case 'section_header':
      return { type, data: { tag: 'PASSAGE', title: '' } };
    case 'info_box':
      return { type, data: { heading: '', rows: [] } };
    case 'paragraph_table':
      return { type, data: { columns: ['문단', '내용'], rows: [], first_col_is_paranum: true } };
    case 'timeline':
      return { type, data: { items: [] } };
    case 'character_grid':
      return { type, data: { columns: 2, cards: [] } };
    case 'compare_2col':
      return { type, data: { left: { title: '', items_html: [] }, right: { title: '', items_html: [] }, left_color: 'navy', right_color: 'red' } };
    case 'concept_grid':
      return { type, data: { columns: 3, cards: [] } };
    case 'process_diagram':
      return { type, data: { title: '', nodes: [], arrows: true } };
    case 'emotion_flow':
      return { type, data: { stages: [], arrow_labels: [] } };
    case 'sijo_box':
      return { type, data: { entries: [] } };
    case 'gist_box':
      return { type, data: { label: '한 줄 요지', body_html: '' } };
    case 'question':
      return { type, data: { num: 0, answer: '①', points: 2, intent: '', prompt_html: '', choices: [], correct_n: '①' } };
  }
}

export default function BlocksEditor({ blocks, onChange, coverPrefill }: BlocksEditorProps) {
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  const [jsonMode, setJsonMode] = useState<Record<number, boolean>>({});

  function update(i: number, next: Block) {
    onChange(blocks.map((b, idx) => (idx === i ? next : b)));
  }
  function remove(i: number) {
    onChange(blocks.filter((_, idx) => idx !== i));
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= blocks.length) return;
    const next = blocks.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  }
  function add(type: BlockType) {
    let next = makeDefaultData(type);
    if (type === 'cover' && coverPrefill) {
      next = { type: 'cover', data: { ...coverPrefill } };
    }
    onChange([...blocks, next]);
  }

  return (
    <div className="flex flex-col gap-3">
      {/* 블록 리스트 */}
      <div className="flex flex-col gap-2">
        {blocks.map((b, i) => {
          const isCollapsed = collapsed[i] ?? false;
          const isJson = jsonMode[i] ?? false;
          const isLiterature = LITERATURE_ONLY_BLOCKS.includes(b.type);
          return (
            <div key={i} className={`border rounded-lg bg-white ${isLiterature ? 'border-amber-200' : 'border-gray-200'}`}>
              <div className={`flex items-center justify-between px-3 py-2 border-b ${isLiterature ? 'bg-amber-50/50 border-amber-200' : 'bg-gray-50 border-gray-200'}`}>
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <button
                    type="button"
                    onClick={() => setCollapsed({ ...collapsed, [i]: !isCollapsed })}
                    className="text-gray-500 hover:text-gray-900 text-xs"
                  >
                    {isCollapsed ? '▶' : '▼'}
                  </button>
                  <span className="text-xs font-semibold text-gray-500 w-6 text-right">{i + 1}.</span>
                  <span className="text-sm font-medium text-gray-800 truncate">{BLOCK_LABEL[b.type]}</span>
                  {isLiterature && <span className="text-[10px] text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">문학</span>}
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-30 rounded" title="위로">↑</button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === blocks.length - 1} className="px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-30 rounded" title="아래로">↓</button>
                  <label className="text-xs text-gray-600 inline-flex items-center gap-1 px-2">
                    <input type="checkbox" checked={isJson} onChange={() => setJsonMode({ ...jsonMode, [i]: !isJson })} />
                    JSON
                  </label>
                  <button type="button" onClick={() => remove(i)} className="px-2 py-1 text-xs text-red-700 hover:bg-red-50 rounded" title="삭제">✕</button>
                </div>
              </div>
              {!isCollapsed && (
                <div className="p-3">
                  <BlockEditorRouter block={b} jsonMode={isJson} onChange={(n) => update(i, n)} />
                </div>
              )}
            </div>
          );
        })}
        {blocks.length === 0 && (
          <div className="text-sm text-gray-500 text-center py-6 border-2 border-dashed border-gray-300 rounded-lg">
            아래 「블록 추가」 에서 시작하세요.
          </div>
        )}
      </div>

      {/* 블록 추가 패널 */}
      <div className="border-2 border-rose-200 rounded-lg p-3 bg-rose-50/40">
        <p className="text-xs font-bold text-rose-700 mb-2">블록 추가</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
          {ALL_BLOCK_TYPES.map(t => {
            const priority = NON_FICTION_PRIORITY_BLOCKS.includes(t);
            const literature = LITERATURE_ONLY_BLOCKS.includes(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() => add(t)}
                className={`px-2 py-1.5 text-xs rounded border text-left transition-colors ${priority
                  ? 'bg-white border-rose-300 text-rose-800 hover:bg-rose-100'
                  : literature
                    ? 'bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100'
                    : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                  }`}
                title={literature ? '문학 전용 — JSON 직편집' : undefined}
              >
                + {BLOCK_LABEL[t]}
              </button>
            );
          })}
        </div>
        <p className="text-[10px] text-gray-500 mt-2 leading-relaxed">
          분홍 = 비문학 우선 (전용 폼) · 호박 = 문학 전용 (JSON 직편집)
        </p>
      </div>
    </div>
  );
}
