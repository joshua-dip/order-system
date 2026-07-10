/** 문법 문제관리 클라이언트 공용 — 페이지/인쇄 뷰에서 함께 사용 (page.tsx 에서 export 하면 Next 페이지 타입 검사에 걸림). */

export interface SubjectiveForm {
  type: string;
  instruction: string;
  answer: string;
  choices?: string[];
}

export interface BankProblem {
  id: string;
  serial: string;
  section: string;
  no: number;
  type: string;
  /** 형식 대분류 — 객관식 | 주관식 | 선택형 (API 필터·배지용) */
  category?: string;
  instruction: string;
  choices?: string[];
  /** 객관식 선택지 (①~④ 순서) */
  options?: string[];
  question: string;
  answer: string;
  explanation: string;
  source: string;
  /** 객관식 전환 전 주관식 원형 (본문 동일, 지시문·정답만 다름) */
  subjective?: SubjectiveForm;
}

export type BankFormat = 'mc' | 'subjective';

/** 표시 형식에 맞는 지시문/유형/정답/보기 — 주관식 원형이 없으면 그대로 */
export function problemView(p: BankProblem, fmt: BankFormat) {
  if (fmt === 'subjective' && p.subjective) {
    return { type: p.subjective.type, instruction: p.subjective.instruction, answer: p.subjective.answer, choices: p.subjective.choices, options: undefined as string[] | undefined };
  }
  return { type: p.type, instruction: p.instruction, answer: p.answer, choices: p.choices, options: p.options };
}

export const CIRCLED_NUMS = ['①', '②', '③', '④', '⑤'];

/** 카테고리(객관식/주관식/선택형) 배지 색 — 기능적 구분용(차분한 톤). */
export function categoryBadgeClass(cat?: string): string {
  switch (cat) {
    case '객관식': return 'border border-sky-500/30 bg-sky-500/10 text-sky-300';
    case '주관식': return 'border border-amber-500/30 bg-amber-500/10 text-amber-300';
    case '선택형': return 'border border-violet-500/30 bg-violet-500/10 text-violet-300';
    default: return 'border border-zinc-700 bg-zinc-800 text-zinc-400';
  }
}

/** 객관식 정답 표기: "③" → "③ was" (options 있으면 내용 병기) */
export function answerLabel(p: BankProblem): string {
  const idx = CIRCLED_NUMS.indexOf(p.answer.trim());
  if (idx >= 0 && p.options && p.options[idx] !== undefined) return `${p.answer} ${p.options[idx]}`;
  return p.answer;
}

/** 문항 텍스트 렌더 — HTML 이스케이프 후 <u> 밑줄만 허용 */
export function questionHtml(s: string): string {
  const esc = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc.replace(/&lt;u&gt;/g, '<u>').replace(/&lt;\/u&gt;/g, '</u>');
}
