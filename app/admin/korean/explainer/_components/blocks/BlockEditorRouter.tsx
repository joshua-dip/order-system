'use client';

import type { Block } from '@/lib/korean-explainer/types';
import CoverForm from './CoverForm';
import SectionHeaderForm from './SectionHeaderForm';
import InfoBoxForm from './InfoBoxForm';
import ParagraphTableForm from './ParagraphTableForm';
import Compare2ColForm from './Compare2ColForm';
import ConceptGridForm from './ConceptGridForm';
import ProcessDiagramForm from './ProcessDiagramForm';
import GistBoxForm from './GistBoxForm';
import QuestionForm from './QuestionForm';
import JsonBlockForm from './JsonBlockForm';

interface BlockEditorRouterProps {
  block: Block;
  onChange: (next: Block) => void;
  /** 사용자가 JSON 직편집 모드를 명시적으로 토글 */
  jsonMode?: boolean;
}

export default function BlockEditorRouter({ block, onChange, jsonMode }: BlockEditorRouterProps) {
  if (jsonMode) {
    return <JsonBlockForm data={block.data} onChange={d => onChange({ ...block, data: d } as Block)} />;
  }

  switch (block.type) {
    case 'cover':
      return <CoverForm data={block.data} onChange={d => onChange({ type: 'cover', data: d })} />;
    case 'section_header':
      return <SectionHeaderForm data={block.data} onChange={d => onChange({ type: 'section_header', data: d })} />;
    case 'info_box':
      return <InfoBoxForm data={block.data} onChange={d => onChange({ type: 'info_box', data: d })} />;
    case 'paragraph_table':
      return <ParagraphTableForm data={block.data} onChange={d => onChange({ type: 'paragraph_table', data: d })} />;
    case 'compare_2col':
      return <Compare2ColForm data={block.data} onChange={d => onChange({ type: 'compare_2col', data: d })} />;
    case 'concept_grid':
      return <ConceptGridForm data={block.data} onChange={d => onChange({ type: 'concept_grid', data: d })} />;
    case 'process_diagram':
      return <ProcessDiagramForm data={block.data} onChange={d => onChange({ type: 'process_diagram', data: d })} />;
    case 'gist_box':
      return <GistBoxForm data={block.data} onChange={d => onChange({ type: 'gist_box', data: d })} />;
    case 'question':
      return <QuestionForm data={block.data} onChange={d => onChange({ type: 'question', data: d })} />;

    // 문학 4종 — 1차에는 JSON 직편집만
    case 'character_grid':
    case 'timeline':
    case 'emotion_flow':
    case 'sijo_box':
      return (
        <JsonBlockForm
          data={block.data}
          onChange={d => onChange({ ...block, data: d } as Block)}
          note="문학 전용 블록 — 데이터 import 파이프라인이 정해지기 전까지 JSON 직편집만 지원합니다 (BLOCK_CATALOG.md 참고)."
        />
      );
  }
}
