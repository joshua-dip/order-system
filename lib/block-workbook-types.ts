/**
 * 블록 빈칸 워크북 — 데이터 모델 정의.
 *
 * 사용자는 지문 본문에서 단어/구/문장을 「블록」으로 지정하고, 같은 셀렉션에서
 * 6가지 워크북을 동시에 생성한다.
 *
 *   A. 단어 빈칸          — 길이 1 토큰 블록을 본문에서 ____ 마스킹, 보기 박스에 알파벳순
 *   B. 구 빈칸            — 길이 2~5 토큰 블록을 본문에서 ____ 마스킹, 보기 박스에 알파벳순
 *   C. 문장 영작          — 한 문장 전체 블록을 그 자리에 한국어 해석으로 대체, 학생이 영작
 *   D. 어순 배열          — 한 문장 전체 블록을 5~8 청크로 잘라 셔플, 학생이 (A)(B)(C)... 순서 작성
 *   E. 핵심 표현 정리     — 모든 블록을 「영어 — 한국어」 2열 표로 정리 (학습 카드)
 *   F. 어법 변형          — 단어 블록의 base form 만 노출, 학생이 문맥에 맞게 어형 변환
 */

export interface SentenceTokenized {
  /** 문장 인덱스 (0-base) */
  idx: number;
  /** 문장 원문 (정리·재조합용) */
  text: string;
  /** 단어 단위 토큰. 구두점은 토큰 끝에 붙어 있을 수 있음. */
  tokens: string[];
  /**
   * 문장 단위 한국어 해석. passages.content.sentences_ko 가 있으면 자동으로 채워진다.
   * sentence 블록의 koreanMeaning 이 비어 있을 때 fallback 으로 사용.
   */
  korean?: string;
}

export type BlockKind = 'word' | 'phrase' | 'sentence';

/**
 * 블록을 어떤 유형에 활용할지 — 워크북 변형문제와 1:1.
 *  - A: 단어 빈칸 (빈칸 추론 - 어휘)
 *  - B: 구·표현 빈칸 (빈칸 추론 - 어구)
 *  - C: 문장 영작 (서술형 영작)
 *  - D: 어순 배열 (문장 내부 청크 순서)
 *  - I: 접속사·접속부사 빈칸 (5지선다, 정답 + distractor 4개)
 *
 * 옛 'E' / 'F' 는 deprecated. 'E' (핵심 표현 정리) 는 어휘 학습 카드에 가까워 변형문제 워크북에서 제거.
 * 'F' (어법 변형) 는 별도 「어법공략 워크북」 탭으로 분리.
 * 옛 데이터 호환을 위해 타입 자체에는 남겨 두지만 ELIGIBLE_USES_BY_KIND·렌더러는 무시.
 */
export type BlockUse = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'I';

/** 하위 호환용 별칭 — sentence 블록 한정 'C' | 'D'. */
export type SentenceUse = Extract<BlockUse, 'C' | 'D'>;

export interface SelectionBlock {
  sentenceIdx: number;
  startTokenIdx: number;
  /** inclusive */
  endTokenIdx: number;
  kind: BlockKind;
  /**
   * 한국어 의미. C(문장 영작) / E(핵심 표현 정리) 에서 사용.
   * - sentence 블록: C 의 한국어 해석문 / E 의 한국어 의미
   * - word·phrase 블록: E 의 한국어 의미
   */
  koreanMeaning?: string;
  /** F(어법 변형) 에서 사용. word 블록 전용. 학생에게 노출할 lemma. */
  baseForm?: string;
  /**
   * I(접속사·접속부사 빈칸) 에서 사용. word/phrase 블록 전용.
   * 정답을 제외한 distractor 4개 (5지선다 옵션 = 정답 + distractor 4).
   * 비어 있거나 4개 미만이면 DEFAULT_CONNECTOR_POOL 에서 자동 채움 (정답·이미 입력된 항목 제외).
   */
  distractors?: string[];
  /**
   * 이 블록을 어떤 유형(A~F) 에 활용할지.
   * - undefined: 백워드 호환 — kind 별 적격 유형 전부 사용 (기존 데이터 동작 보존)
   *   - word: ['A','E','F']
   *   - phrase: ['B','E']
   *   - sentence: ['C','D','E']
   * - 명시 시 그 배열에 들어 있는 유형에만 노출.
   * 적격 외 유형(예: word 블록의 'C') 은 무시.
   */
  uses?: BlockUse[];
}

/**
 * kind 별로 활용 가능한 use 후보. UI 토글·검증·기본값 계산에 사용.
 * 옛 'E','F' 는 의도적으로 제외 — 백워드 데이터의 uses 에 들어 있어도 effectiveUses 에서 자동 필터됨.
 */
export const ELIGIBLE_USES_BY_KIND: Record<BlockKind, BlockUse[]> = {
  word: ['A', 'I'],
  phrase: ['B', 'I'],
  sentence: ['C', 'D'],
};

/**
 * I (접속사·접속부사 빈칸) distractor 자동 채움용 풀.
 * 사용자가 입력한 distractor 가 4개 미만일 때, 정답·이미 입력된 항목과 겹치지 않는 후보를
 * 결정적 셔플로 골라 채운다.
 */
export const DEFAULT_CONNECTOR_POOL: string[] = [
  'However',
  'Therefore',
  'Moreover',
  'Nevertheless',
  'In addition',
  'For example',
  'Otherwise',
  'On the other hand',
  'In contrast',
  'As a result',
  'Furthermore',
  'Meanwhile',
  'Instead',
  'Similarly',
  'Thus',
];

/**
 * 블록의 「실효 uses」 — uses 가 비어 있으면 kind 별 기본값.
 * 단 'I' (접속사 빈칸) 는 명시적 opt-in 만 허용 — 옛 데이터 (uses 미설정 word/phrase) 가
 * 갑자기 I 페이지에 노출되지 않도록 백워드 가드.
 */
export function effectiveUses(b: SelectionBlock): BlockUse[] {
  if (b.uses && b.uses.length > 0) {
    const eligible = ELIGIBLE_USES_BY_KIND[b.kind];
    return b.uses.filter(u => eligible.includes(u));
  }
  return ELIGIBLE_USES_BY_KIND[b.kind].filter(u => u !== 'I');
}

/** 블록이 특정 use 에 활용되는지. undefined uses 는 kind 적격 use 전부로 간주(백워드 호환). */
export function blockUseIncludes(b: SelectionBlock, use: BlockUse): boolean {
  return effectiveUses(b).includes(use);
}

/** 하위 호환 별칭 — 기존 호출부가 sentence 블록에 'C'/'D' 검사하던 코드를 그대로 두기 위함. */
export function sentenceUsesIncludes(b: SelectionBlock, use: SentenceUse): boolean {
  if (b.kind !== 'sentence') return false;
  return blockUseIncludes(b, use);
}

/**
 * 블록 빈칸 워크북에서 출력할 워크북 유형.
 * E·F 는 별도 탭으로 분리 (E: 제거, F: 어법공략 워크북). 옛 데이터의 types 에 있어도 무시.
 */
export type WorkbookKind = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'I';

export interface BlockWorkbookSelection {
  sentences: SentenceTokenized[];
  blocks: SelectionBlock[];
}

export interface BlockWorkbookSaveInput {
  passageId: string;
  textbook: string;
  sourceKey: string;
  title: string;
  folder?: string;
  selection: BlockWorkbookSelection;
  /** 저장 시점에 활성화돼 있던 유형들. 클라이언트에서 결정. */
  types: WorkbookKind[];
  html: Partial<Record<WorkbookKind, string>>;
}

export interface BlockWorkbookDoc extends BlockWorkbookSaveInput {
  _id: string;
  createdAt: string;
  updatedAt: string;
}
