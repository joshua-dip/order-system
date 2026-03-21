/** MongoDB `student_school_grade_records` 문서와 API 페이로드 공통 타입 */

export const EXAM_PERIODS = ['중간고사', '기말고사'] as const;
export type ExamPeriod = (typeof EXAM_PERIODS)[number];

export const SEMESTERS = [1, 2] as const;
export type Semester = (typeof SEMESTERS)[number];

export type SchoolGradeRecordDTO = {
  id: string;
  schoolYear: number;
  semester: Semester;
  examPeriod: ExamPeriod;
  scoreMultipleChoice: number;
  scoreEssay: number;
  createdAt: string;
  updatedAt: string;
};

export function isExamPeriod(p: string): p is ExamPeriod {
  return EXAM_PERIODS.includes(p as ExamPeriod);
}

export function semesterLabel(s: number): string {
  return s === 1 ? '1학기' : s === 2 ? '2학기' : `${s}`;
}
