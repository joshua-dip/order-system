/**
 * 회원별 시험범위 메모.
 *
 * 「이번 2학기 중간·기말은 Booster 유형독해로 본다」 같은 정보를 회원상세에 남겨 두면
 * 다음 시험 자료를 미리 준비하거나, 같은 교재를 쓰는 회원을 한 번에 찾을 때 쓸 수 있다.
 *
 * 회원 문서에 배열로 박지 않고 별도 컬렉션으로 둔 이유 — 교재로 역조회하기 위해서다.
 */
import type { Db, ObjectId } from 'mongodb';

export const MEMBER_EXAM_SCOPE_COLLECTION = 'member_exam_scopes';

export const SEMESTERS = ['1학기', '2학기'] as const;
export const SCOPE_EXAM_TYPES = ['중간고사', '기말고사', '중간·기말 공통'] as const;

export interface MemberExamScopeDoc {
  _id: ObjectId;
  userId: ObjectId;
  loginId: string;
  /** 학년도 (예: '2026') */
  year: string;
  semester: string;
  examType: string;
  /** 시험범위 교재 — 여러 권일 수 있다 */
  textbooks: string[];
  /** 강·과 범위 (예: '1~8강') */
  scopeDetail: string;
  school: string;
  grade: string;
  note: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}

export function normalizeScopeInput(raw: Record<string, unknown>) {
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const semester = str(raw.semester, 10);
  const examType = str(raw.examType, 20);
  const textbooks = Array.isArray(raw.textbooks)
    ? [...new Set(raw.textbooks.filter((t): t is string => typeof t === 'string' && t.trim() !== '').map((t) => t.trim().slice(0, 200)))].slice(0, 10)
    : [];
  return {
    year: str(raw.year, 8) || String(new Date().getFullYear()),
    semester: (SEMESTERS as readonly string[]).includes(semester) ? semester : '2학기',
    examType: (SCOPE_EXAM_TYPES as readonly string[]).includes(examType) ? examType : '중간·기말 공통',
    textbooks,
    scopeDetail: str(raw.scopeDetail, 200),
    school: str(raw.school, 100),
    grade: str(raw.grade, 20),
    note: str(raw.note, 500),
  };
}

export async function ensureMemberExamScopeIndexes(db: Db): Promise<void> {
  const col = db.collection(MEMBER_EXAM_SCOPE_COLLECTION);
  await col.createIndex({ loginId: 1, year: -1, semester: 1 }).catch(() => {});
  // 「이 교재를 시험범위로 쓰는 회원」 역조회용
  await col.createIndex({ textbooks: 1 }).catch(() => {});
}
