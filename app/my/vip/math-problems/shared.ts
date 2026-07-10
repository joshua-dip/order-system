/** 수학 문제관리 클라이언트 공용 — 페이지/인쇄 뷰에서 함께 사용 (page.tsx 에서 export 하면 Next 페이지 타입 검사에 걸림). */

export interface MathBankProblem {
  id: string;
  serial: string;
  no: number;
  difficulty: string; // 기본 | 중 | 고
  type: string; // 주관식 | 객관식
  question: string;
  /** 객관식 선택지 (①~⑤ 순서) */
  choices?: string[];
  answer: string; // 주관식=값/식 · 객관식=①~⑤
  solution: string;
  source: string;
}

export const CIRCLED_NUMS = ['①', '②', '③', '④', '⑤'];

/** 객관식 정답 표기: "③" → "③ 내용" (choices 있으면 내용 병기). 주관식은 그대로. */
export function answerLabel(p: MathBankProblem): string {
  const idx = CIRCLED_NUMS.indexOf(p.answer.trim());
  if (idx >= 0 && p.choices && p.choices[idx] !== undefined) return `${p.answer} ${p.choices[idx]}`;
  return p.answer;
}

/** 문항/풀이 텍스트 렌더 — HTML 이스케이프 후 줄바꿈만 <br> 로 허용. */
export function mathTextHtml(s: string): string {
  const esc = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc.replace(/\n/g, '<br>');
}

/** 난도 배지 색상 (차콜+포인트 플랫). */
export function difficultyBadge(d: string): string {
  if (d === '고') return 'border-rose-500/40 bg-rose-500/10 text-rose-300';
  if (d === '중') return 'border-amber-500/40 bg-amber-500/10 text-amber-300';
  return 'border-zinc-600 bg-zinc-800/60 text-zinc-300';
}
