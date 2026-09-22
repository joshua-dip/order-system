/** 워크북키트 — 주문 blank_package / word_arrangement / 어법 패키지와 대응 */

export type BlankKind = 'adj' | 'keyword' | 'noun' | 'prep' | 'verb';

export type KitMaterialType =
  | `blank_${BlankKind}`
  | 'word_arrange'
  | 'grammar_either_or'
  | 'grammar_correction';

export const BLANK_KINDS: readonly BlankKind[] = ['adj', 'keyword', 'noun', 'prep', 'verb'] as const;

export const KIT_TYPE_LABEL: Record<KitMaterialType, string> = {
  blank_adj: '빈칸쓰기 · 형용사',
  blank_keyword: '빈칸쓰기 · 키워드',
  blank_noun: '빈칸쓰기 · 명사',
  blank_prep: '빈칸쓰기 · 전치사',
  blank_verb: '빈칸쓰기 · 동사',
  word_arrange: '낱말배열',
  grammar_either_or: '어법 · 양자택일',
  grammar_correction: '어법 · 오류수정',
};

export interface KitPassageInput {
  id: string;
  textbook: string;
  chapter: string;
  number: string;
  sourceKey: string;
  sentencesEn: string[];
  sentencesKo: string[];
}

export interface BlankHit {
  /** 1-based 빈칸 번호 */
  n: number;
  answer: string;
}

export interface BlankPassageResult {
  sourceKey: string;
  kind: BlankKind;
  /** EN 문장 — 빈칸은 `(n) __________` */
  blankedLines: string[];
  /** 같은 인덱스 KO (없을 수 있음) */
  koLines: string[];
  answers: BlankHit[];
}

export interface WordArrangeItem {
  n: number;
  ko: string;
  shuffled: string[];
  answer: string;
}

export interface WordArrangePassageResult {
  sourceKey: string;
  prompt: string;
  items: WordArrangeItem[];
}

export interface KitGenerateOptions {
  /** 빈칸: EN 아래 KO 한 줄 (샘플「번역포함」) */
  includeTranslation?: boolean;
  types: KitMaterialType[];
}

export interface KitHtmlEntry {
  type: KitMaterialType;
  fileName: string;
  title: string;
  html: string;
  questionCount: number;
  warning?: string;
}
