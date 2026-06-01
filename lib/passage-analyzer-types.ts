/** 지문분석기 — 참조 PassageAnalyzerMain / passage-analyzer-types 정리 (JSON 저장용은 Set 대신 배열) */

export interface FilePermissions {
  viewAnalysis: boolean;
  runAnalysis: boolean;
  editVocabulary: boolean;
  exportPdf: boolean;
  exportNotion: boolean;
  createQuestions: boolean;
}

export type AnalysisMode = 'individual' | 'collaboration';

export const TASK_KEYS = [
  'comprehensive',
  'topicSentence',
  'essaySentence',
  'grammar',
  'context',
  'sentenceBreaks',
  'svoc',
  'grammarTags',
  'contextWords',
  'vocabulary',
  'structureDiagram',
] as const;
export type TaskKey = (typeof TASK_KEYS)[number];

export type EditorViewMode =
  | 'base'
  | 'topicSentence'
  | 'essaySentence'
  | 'grammar'
  | 'context'
  | 'sentenceBreaks'
  | 'svoc'
  | 'syntax'
  | 'grammarTags'
  | 'grammarPoints'
  | 'vocabulary';

export interface PassageDataRow {
  교재명?: string;
  강?: string;
  페이지?: string;
  번호?: string;
  원문?: string;
  해석?: string;
  '문장구분(영)'?: string;
  '문장구분(한)'?: string;
  'Tokenized Sentences (English)'?: string;
  'Tokenized Sentences (Korean)'?: string;
  'Mixed Sentences'?: string;
  Original?: string;
  English?: string;
  '원문(영)'?: string;
  Translation?: string;
  Korean?: string;
  '해석(한)'?: string;
  [key: string]: unknown;
}

export interface SvocSentenceData {
  subject: string;
  verb: string;
  object?: string | null;
  complement?: string | null;
  indirectObject?: string | null;
  directObject?: string | null;
  subjectComplement?: string | null;
  objectComplement?: string | null;
  subjectStart: number;
  subjectEnd: number;
  verbStart: number;
  verbEnd: number;
  objectStart?: number | null;
  objectEnd?: number | null;
  complementStart?: number | null;
  complementEnd?: number | null;
  indirectObjectStart?: number | null;
  indirectObjectEnd?: number | null;
  directObjectStart?: number | null;
  directObjectEnd?: number | null;
  subjectComplementStart?: number | null;
  subjectComplementEnd?: number | null;
  objectComplementStart?: number | null;
  objectComplementEnd?: number | null;
}

export interface SyntaxPhraseStored {
  text: string;
  label: string;
  type: 'clause' | 'phrase';
  startIndex: number;
  endIndex: number;
  color: string;
  depth: number;
  modifies?: string | null;
  hideLabel?: boolean;
}

export interface GrammarTagStored {
  sentenceIndex: number;
  tagName: string;
  selectedText: string;
  startWordIndex: number;
  endWordIndex: number;
  isAIGenerated?: boolean;
  explanation?: string;
  category?: string;
  subCategory?: string;
}

/** 「문법 포인트」 모드 — 서술형 출제기 답지의 grammar_points와 같은 형태({개념명, 그 문장에서의 표현}). 단어 위치 anchored 아님. */
export interface GrammarPointEntry {
  title: string;
  content: string;
}

export interface VocabularyEntry {
  word: string;
  meaning: string;
  wordType?: string;
  partOfSpeech?: string;
  /** CEFR 어휘 난이도 (예: A1~C2). 비우면 미지정 */
  cefr?: string;
  synonym?: string;
  antonym?: string;
  positions?: { sentence: number; position: number }[];
  sourcePassage?: string | number;
  totalWords?: number;
  uniqueWords?: number;
  opposite?: string;
}

/** MongoDB·API에 저장되는 지문 단위 상태 (Set → number[] / string[]) */
export interface PassageStateStored {
  analysisResults?: Record<string, unknown>;
  showAnalysis?: boolean;
  topicHighlightedSentences?: number[];
  essayHighlightedSentences?: number[];
  insertionHighlightedSentences?: number[];
  grammarSelectedWords?: string[];
  /** 어법 AI 호출 시 사용하는 사용자 프롬프트(비우면 서버 기본) */
  grammarAiPrompt?: string;
  grammarSelectedRanges?: { sentenceIndex: number; startWordIndex: number; endWordIndex: number }[];
  contextSelectedWords?: string[];
  /** 문맥 AI 호출 시 사용하는 사용자 프롬프트(비우면 서버 기본) */
  contextAiPrompt?: string;
  sentences: string[];
  koreanSentences: string[];
  vocabularyList: VocabularyEntry[];
  /** 단어장 자동 생성·불용어 제거 시 함께 쓰는 사용자 정의 불용어(소문자 권장) */
  vocabularyCustomStopWords?: string[];
  /** 단어장 표 정렬(원본 배열 순서 / 알파벳 / 지문 내 위치) */
  vocabularySortOrder?: 'original' | 'alphabetical' | 'position';
  showVocabulary?: boolean;
  /**
   * SVOC 분석 데이터 — 한 sentence 안에 여러 절(coordinated clause)이 있을 수 있어 array 지원.
   * 백워드 호환: 단일 SvocSentenceData 객체로 저장된 옛 데이터도 그대로 둠.
   * **읽을 때는 항상 `getSvocClauses(svocData, sentIdx)` 헬퍼로 array 받아 처리.**
   */
  svocData?: Record<number, SvocSentenceData | SvocSentenceData[]>;
  grammarTags?: GrammarTagStored[];
  /** 문장 인덱스 → 문법 포인트 카드 리스트 (서술형 답지 grammar_points와 동일 모양) */
  grammarPointsBySentence?: Record<number, GrammarPointEntry[]>;
  sentenceBreaks?: Record<number, number[]>;
  syntaxPhrases?: Record<number, SyntaxPhraseStored[]>;
  structureDiagramLink?: string;
  memo?: string;
  /** 종합분석: 항목 1~5 질문 문구(비우면 서버 기본값). */
  comprehensiveCustomPrompts?: Record<string, string>;
  /** 종합분석 결과 설명 위주 언어(레거시: 항목별 값이 없을 때 기본) */
  comprehensiveOutputLang?: 'ko' | 'en';
  /** 종합분석 항목 번호(문자열 "1"…)별 답변 본문 언어. 없으면 comprehensiveOutputLang 사용 */
  comprehensiveOutputLangBySlot?: Record<string, 'ko' | 'en'>;
  /** 종합분석: 전체 프롬프트. 값이 있으면 1~5 항목보다 우선({{지문}} 치환). */
  comprehensiveMasterPrompt?: string;
  /** 종합분석 항목 개수(최소 5). 6 이상이면 추가 항목 슬롯. */
  comprehensiveSlotCount?: number;
  /** 왼쪽 편집 모드(기본·주제문장·…) 버튼 표시 순서 */
  editorViewModeOrder?: EditorViewMode[];
  manualStepStatus?: Record<string, boolean>;
  stepMemos?: Record<string, string>;
  sentenceMemos?: Record<number, Array<{ id: string; author: string; authorId: string; content: string; createdAt: string }>>;
}

export const SVOC_COMPONENTS = [
  { id: 'subject' as const, label: '주어', short: 'S', key: '1', color: 'yellow' },
  { id: 'verb' as const, label: '동사', short: 'V', key: '2', color: 'blue' },
  { id: 'indirectObject' as const, label: '간접목적어', short: 'Oi', key: '3', color: 'emerald' },
  { id: 'directObject' as const, label: '직접목적어', short: 'Od', key: '4', color: 'green' },
  { id: 'subjectComplement' as const, label: '주격보어', short: 'Cs', key: '5', color: 'purple' },
  { id: 'objectComplement' as const, label: '목적격보어', short: 'Co', key: '6', color: 'pink' },
] as const;

export type SvocComponentId = (typeof SVOC_COMPONENTS)[number]['id'];

/**
 * SVOC 단어 배경색 — SVOC_COMPONENTS.color 와 동일 계열의 RGBA 파스텔.
 * PassageAnalyzerEditor 와 /qna 페이지에서 동일하게 import → 톤 100% 일치.
 */
export const SVOC_WORD_BG: Record<(typeof SVOC_COMPONENTS)[number]['color'], string> = {
  yellow: 'rgba(234,179,8,0.42)',
  blue: 'rgba(59,130,246,0.42)',
  emerald: 'rgba(16,185,129,0.38)',
  green: 'rgba(34,197,94,0.38)',
  purple: 'rgba(168,85,247,0.38)',
  pink: 'rgba(236,72,153,0.38)',
};

/** SVOC 컴포넌트 id → svocData 안의 텍스트/시작/끝 필드 이름 매핑 */
export const SVOC_FIELDS: Record<
  SvocComponentId,
  { text: keyof SvocSentenceData; start: keyof SvocSentenceData; end: keyof SvocSentenceData }
> = {
  subject: { text: 'subject', start: 'subjectStart', end: 'subjectEnd' },
  verb: { text: 'verb', start: 'verbStart', end: 'verbEnd' },
  indirectObject: {
    text: 'indirectObject',
    start: 'indirectObjectStart',
    end: 'indirectObjectEnd',
  },
  directObject: {
    text: 'directObject',
    start: 'directObjectStart',
    end: 'directObjectEnd',
  },
  subjectComplement: {
    text: 'subjectComplement',
    start: 'subjectComplementStart',
    end: 'subjectComplementEnd',
  },
  objectComplement: {
    text: 'objectComplement',
    start: 'objectComplementStart',
    end: 'objectComplementEnd',
  },
};

export function passageAnalysisFileNameForPassageId(passageId: string): string {
  return `passage:${passageId}`;
}

export function parsePassageIdFromFileName(fileName: string): string | null {
  const m = fileName.match(/^passage:([a-f0-9]{24})$/i);
  return m ? m[1] : null;
}

/**
 * svocData 의 한 sentence 항목을 「항상 array」 로 반환.
 *
 * 백워드 호환: 단일 객체 / array / undefined 모두 받음.
 * - undefined → []
 * - 단일 SvocSentenceData → [객체]
 * - SvocSentenceData[] → 그대로
 *
 * 모든 reader 가 이 헬퍼 통해 접근해야 단일·다절 데이터에 동일 코드로 동작.
 */
export function getSvocClauses(
  svocData: PassageStateStored['svocData'] | undefined,
  sentenceIndex: number,
): SvocSentenceData[] {
  if (!svocData) return [];
  const v = svocData[sentenceIndex];
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return [v];
}

/** sentence 안에 SVOC 절이 1개 이상 있는지 (분석 안 된 빈 placeholder 제외) */
export function hasAnyMeaningfulSvocClause(
  svocData: PassageStateStored['svocData'] | undefined,
  sentenceIndex: number,
): boolean {
  const clauses = getSvocClauses(svocData, sentenceIndex);
  return clauses.some(
    (c) => (c.subject || '').trim().length > 0 || (c.verb || '').trim().length > 0,
  );
}
