export const STUDENT_GRADE_OPTIONS = [
  { value: '초6', label: '초6' },
  { value: '중1', label: '중1' },
  { value: '중2', label: '중2' },
  { value: '중3', label: '중3' },
  { value: '고1', label: '고1' },
  { value: '고2', label: '고2' },
  { value: '고3', label: '고3' },
  { value: '재수', label: '재수' },
  { value: '기타', label: '기타' },
] as const;

export type StudentGrade = (typeof STUDENT_GRADE_OPTIONS)[number]['value'];

export function gradeLabel(grade?: string): string {
  if (!grade) return '';
  return grade;
}
