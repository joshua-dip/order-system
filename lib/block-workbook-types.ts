/**
 * 블록 빈칸 워크북 — 데이터 모델 정의.
 *
 * 사용자는 지문 본문에서 단어/구/문장을 「블록」으로 지정하고, 같은 셀렉션에서
 * A·B·C 세 가지 워크북을 동시에 생성한다.
 *
 *   A. 단어 빈칸    — 길이 1 토큰 블록을 본문에서 ____ 마스킹, 보기 박스에 알파벳순 노출
 *   B. 구 빈칸      — 길이 2~5 토큰 블록을 본문에서 ____ 마스킹, 보기 박스에 알파벳순 노출
 *   C. 문장 영작    — 한 문장 전체 블록을 그 자리에 한국어 해석으로 대체, 학생이 영작
 */

export interface SentenceTokenized {
  /** 문장 인덱스 (0-base) */
  idx: number;
  /** 문장 원문 (정리·재조합용) */
  text: string;
  /** 단어 단위 토큰. 구두점은 토큰 끝에 붙어 있을 수 있음. */
  tokens: string[];
}

export type BlockKind = 'word' | 'phrase' | 'sentence';

export interface SelectionBlock {
  sentenceIdx: number;
  startTokenIdx: number;
  /** inclusive */
  endTokenIdx: number;
  kind: BlockKind;
  /** C형(문장 영작)에서 사용. 사용자가 직접 입력하는 한국어 해석. */
  koreanMeaning?: string;
}

export type WorkbookKind = 'A' | 'B' | 'C';

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
