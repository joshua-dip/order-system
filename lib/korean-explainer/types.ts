/**
 * 국어 해설지 블록 13종 타입 정의 — BLOCK_CATALOG.md 와 1:1 매핑.
 *
 * 갈래(genre)는 데이터 조합으로만 흡수한다. 코드에 갈래 분기 금지.
 * `*_html` 필드는 sanitize 후 신뢰된 HTML 조각으로 렌더한다.
 *   허용 인라인: span.hl-key | hl-term | hl-cause | hl-effect, strong, em, u, br
 */

export type GenreCategory = 'non-fiction' | 'literature';

export type Genre =
  | '독서(인문)'
  | '독서(사회)'
  | '독서(과학·기술)'
  | '독서(예술)'
  | '독서(주제 복합)'
  | '화법/작문'
  | '문법'
  | '현대소설'
  | '현대시'
  | '고전시가'
  | '고전소설'
  | '복합(고전·현대)'
  | '복합(시·소설)';

export const NON_FICTION_GENRES: Genre[] = [
  '독서(인문)',
  '독서(사회)',
  '독서(과학·기술)',
  '독서(예술)',
  '독서(주제 복합)',
  '화법/작문',
  '문법',
];

export const LITERATURE_GENRES: Genre[] = [
  '현대소설',
  '현대시',
  '고전시가',
  '고전소설',
  '복합(고전·현대)',
  '복합(시·소설)',
];

export function genreCategory(genre: Genre): GenreCategory {
  return NON_FICTION_GENRES.includes(genre) ? 'non-fiction' : 'literature';
}

// ── 인라인 하이라이트 ─────────────────────────────────────────────────────────

export type HighlightClass = 'hl-key' | 'hl-term' | 'hl-cause' | 'hl-effect';

// ── 블록 13종 ─────────────────────────────────────────────────────────────────

/** 1. 표지 */
export interface CoverData {
  exam_title: string;
  set_range: string;
  genre: string;
  work_title: string;
  show_subtitle?: boolean;
}

/** 2. 섹션 헤더 */
export interface SectionHeaderData {
  tag: 'PASSAGE' | 'SOLUTION' | 'CONCEPTS' | string;
  title: string;
}

/** 3. 기본 정보 표 */
export interface InfoBoxData {
  heading: string;
  rows: Array<{ label: string; value_html: string }>;
}

/** 4. 문단/장면별 요약 표 */
export interface ParagraphTableData {
  columns: string[];
  rows: Array<{ cells: string[] }>;
  first_col_is_paranum?: boolean;
}

/** 5. 사건 흐름 (서사/소설) */
export interface TimelineData {
  items: Array<{ time: string; content_html: string }>;
}

/** 6. 등장인물 (소설) */
export interface CharacterGridData {
  columns: 2 | 3;
  cards: Array<{ name: string; role: string; desc_html: string }>;
}

/** 7. 2항 대조 (A vs B, [A]/[B], ㉠/㉡ 등) */
export interface Compare2ColData {
  left: { title: string; items_html: string[] };
  right: { title: string; items_html: string[] };
  left_color: 'navy' | 'green';
  right_color: 'red' | 'navy';
}

/** 8. 핵심 개념/용어 카드 */
export interface ConceptGridData {
  columns: 2 | 3;
  cards: Array<{ name: string; desc_html: string }>;
}

/** 9. 과정 흐름도 (과학/절차) */
export interface ProcessDiagramData {
  title?: string;
  nodes: Array<{ label: string; body_html: string; variant?: 'light' | 'dark' | '' }>;
  arrows?: boolean;
}

/** 10. 정서 3단계 (현대시) */
export interface EmotionFlowData {
  stages: Array<{ label: string; body_html: string; mood: 'negative' | 'trigger' | 'positive' }>;
  /** 단계 사이 화살표 라벨. 길이 = stages.length - 1 */
  arrow_labels: string[];
}

/** 11. 시조/고전운문 풀이 (고전시가) */
export interface SijoBoxData {
  entries: Array<{ num: number | string; original: string; modern_html: string }>;
}

/** 12. 한 줄 요지 / 마무리 안내 */
export interface GistBoxData {
  label: string;
  body_html: string;
}

/** 13. 문제 해설 (모든 갈래 공통) */
export interface QuestionData {
  num: number;
  /** "①" ~ "⑤" */
  answer: string;
  points: number;
  intent: string;
  prompt_html: string;
  evidences?: Array<{ label: string; body_html: string }>;
  choices: Array<{ n: string; judge: 'O' | 'X'; text_html: string }>;
  /** 노란 하이라이트 행을 결정. choices[*].n 중 하나와 일치해야 함. */
  correct_n: string;
  trap?: { title: string; body_html: string };
}

// ── 디스크리미네이티드 유니온 ──────────────────────────────────────────────────

export type Block =
  | { type: 'cover'; data: CoverData }
  | { type: 'section_header'; data: SectionHeaderData }
  | { type: 'info_box'; data: InfoBoxData }
  | { type: 'paragraph_table'; data: ParagraphTableData }
  | { type: 'timeline'; data: TimelineData }
  | { type: 'character_grid'; data: CharacterGridData }
  | { type: 'compare_2col'; data: Compare2ColData }
  | { type: 'concept_grid'; data: ConceptGridData }
  | { type: 'process_diagram'; data: ProcessDiagramData }
  | { type: 'emotion_flow'; data: EmotionFlowData }
  | { type: 'sijo_box'; data: SijoBoxData }
  | { type: 'gist_box'; data: GistBoxData }
  | { type: 'question'; data: QuestionData };

export type BlockType = Block['type'];

export const ALL_BLOCK_TYPES: BlockType[] = [
  'cover',
  'section_header',
  'info_box',
  'paragraph_table',
  'timeline',
  'character_grid',
  'compare_2col',
  'concept_grid',
  'process_diagram',
  'emotion_flow',
  'sijo_box',
  'gist_box',
  'question',
];

/** 비문학 편집기(PR #3) 우선 지원 블록. 문학 전용은 후속 epic. */
export const NON_FICTION_PRIORITY_BLOCKS: BlockType[] = [
  'cover',
  'section_header',
  'info_box',
  'paragraph_table',
  'compare_2col',
  'concept_grid',
  'process_diagram',
  'gist_box',
  'question',
];

/** 문학 전용 블록 — 데이터 import 파이프라인 후속 도입. */
export const LITERATURE_ONLY_BLOCKS: BlockType[] = [
  'character_grid',
  'timeline',
  'emotion_flow',
  'sijo_box',
];

// ── 해설지 문서 ──────────────────────────────────────────────────────────────

export interface KoreanExplanation {
  exam_title: string;
  set_range: string;
  genre: Genre | string;
  work_title: string;
  show_subtitle?: boolean;
  blocks: Block[];
}
