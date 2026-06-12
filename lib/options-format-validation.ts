/**
 * Options 저장 형식 검증 공용 로직.
 *
 * 표준 저장 형식: `① … ### ② … ### ⑤ …` 문자열 (보기 5개, ①~⑤ 접두사).
 * 비표준이면 회원 내보내기에서 선택지가 사라지거나(배열 저장 — export 의 str() 가드),
 * 번호 없는 보기가 그대로 출력된다(렌더러는 번호를 자동 부여하지 않음).
 *
 * /api/admin/generated-questions/validate/options-format 라우트와
 * 전체 검수 CLI(scripts/audit-variant-validate-textbook.ts)에서 사용.
 */
import { splitQuestionOptionSegments } from '@/lib/question-options-segments';
import { isWorkbookType } from '@/lib/member-variant-export-build';

export type OptionsFormatIssueKind =
  | 'missing'
  | 'stored_as_array'
  | 'no_circled_prefix'
  | 'partial_circled_prefix'
  | 'bad_segment_count';

export const OPTIONS_FORMAT_ISSUE_LABEL: Record<OptionsFormatIssueKind, string> = {
  missing: '데이터 없음',
  stored_as_array: '배열 저장',
  no_circled_prefix: '번호 없음',
  partial_circled_prefix: '번호 일부만',
  bad_segment_count: '보기 수 ≠ 5',
};

const CIRCLED_PREFIX_RE = /^[①②③④⑤]/;

/** 워크북 계열 유형은 Options 열을 쓰지 않으므로 검증 대상에서 제외 */
export function isOptionsFormatCheckTarget(type: string): boolean {
  return !isWorkbookType(type);
}

export interface OptionsFormatResult {
  issues: OptionsFormatIssueKind[];
  segmentCount: number;
  /** 표·로그 표시용 미리보기 (배열이면 join, 아니면 원문 앞부분) */
  preview: string;
}

export function checkOptionsFormat(raw: unknown): OptionsFormatResult {
  if (Array.isArray(raw)) {
    return {
      issues: ['stored_as_array'],
      segmentCount: raw.length,
      preview: raw.map((v) => String(v ?? '')).join(' / '),
    };
  }
  if (typeof raw !== 'string' || !raw.trim()) {
    return { issues: ['missing'], segmentCount: 0, preview: '' };
  }
  const segs = splitQuestionOptionSegments(raw);
  const circledCount = segs.filter((s) => CIRCLED_PREFIX_RE.test(s)).length;
  const issues: OptionsFormatIssueKind[] = [];
  if (segs.length !== 5) issues.push('bad_segment_count');
  if (segs.length > 0 && circledCount === 0) issues.push('no_circled_prefix');
  else if (circledCount > 0 && circledCount < segs.length) issues.push('partial_circled_prefix');
  return { issues, segmentCount: segs.length, preview: raw };
}
