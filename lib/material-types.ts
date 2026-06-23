/**
 * 교재 만들기 — 공용 타입/상수/파서 (서버·클라이언트 공용, DB 의존 없음).
 */
export const MATERIAL_TYPES = ['특강', '문법', '리딩'] as const;
export type MaterialType = (typeof MATERIAL_TYPES)[number];

export const MATERIAL_TYPE_DESC: Record<MaterialType, string> = {
  특강: '특정 주제 집중 강의 교재',
  문법: '문법 포인트·예문·연습 교재',
  리딩: '지문·어휘·독해 문제 교재',
};

export const BLOCK_KINDS = ['heading', 'text', 'passage', 'examples', 'vocab', 'problems'] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];

export const BLOCK_LABEL: Record<BlockKind, string> = {
  heading: '단원 제목',
  text: '설명 / 본문',
  passage: '지문(영문+해석)',
  examples: '예문',
  vocab: '단어',
  problems: '문제',
};

/** 블록 — 단순 모델: 종류 + 소제목 + 본문(content) + 보조(ko). examples/vocab/problems 는 content 의 줄마다 "A | B". */
export interface MaterialBlock {
  id: string;
  kind: BlockKind;
  title?: string; // 블록 소제목(또는 문제 안내문)
  content?: string; // heading 텍스트 / 본문 / 지문 영문 / 줄단위 항목
  ko?: string; // 지문 해석
}

/** examples/vocab/problems 의 줄단위 "A | B" 파싱. */
export function parseRows(content: string | undefined): { a: string; b: string }[] {
  return (content || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf('|');
      return i >= 0 ? { a: l.slice(0, i).trim(), b: l.slice(i + 1).trim() } : { a: l, b: '' };
    });
}

/** 타입별 새 교재의 시작 블록(편집 편의용). */
export function starterBlocks(type: MaterialType, uid: () => string): MaterialBlock[] {
  if (type === '문법') {
    return [
      { id: uid(), kind: 'heading', content: '1. 문법 포인트' },
      { id: uid(), kind: 'text', title: '개념', content: '' },
      { id: uid(), kind: 'examples', title: '예문', content: '' },
      { id: uid(), kind: 'problems', title: '연습 문제', content: '' },
    ];
  }
  if (type === '리딩') {
    return [
      { id: uid(), kind: 'heading', content: 'Reading 1' },
      { id: uid(), kind: 'passage', title: '지문', content: '', ko: '' },
      { id: uid(), kind: 'vocab', title: '어휘', content: '' },
      { id: uid(), kind: 'problems', title: '독해 문제', content: '' },
    ];
  }
  return [
    { id: uid(), kind: 'heading', content: '1강' },
    { id: uid(), kind: 'text', title: '핵심 개념', content: '' },
  ];
}
