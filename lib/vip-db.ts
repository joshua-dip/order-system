import { ObjectId, type Db, type Collection, type WithId, type Document } from 'mongodb';
import { getDb } from './mongodb';

/* ── 컬렉션 이름 ── */
const COL = {
  schools: 'vip_schools',
  students: 'vip_students',
  schoolExams: 'vip_school_exams',
  studentScores: 'vip_student_scores',
  examPapers: 'vip_exam_papers',
  subjects: 'vip_subjects',
} as const;

/* ── 인터페이스 ── */

/** 학교급 — 학년 범위를 결정. 없으면 'high'(고등)로 취급(하위호환). */
export type VipSchoolLevel = 'elem' | 'middle' | 'high';
export const VIP_SCHOOL_LEVELS: VipSchoolLevel[] = ['elem', 'middle', 'high'];
export const VIP_SCHOOL_LEVEL_LABEL: Record<VipSchoolLevel, string> = { elem: '초', middle: '중', high: '고' };
export const VIP_GRADE_RANGE: Record<VipSchoolLevel, number[]> = {
  elem: [1, 2, 3, 4, 5, 6],
  middle: [1, 2, 3],
  high: [1, 2, 3],
};

/** 기본 과목 — 사용자별 과목 마스터(vip_subjects)가 비어있을 때 시드. */
export const DEFAULT_VIP_SUBJECTS = ['국어', '수학', '영어', '과학', '사회'] as const;

/** 사용자별 과목 마스터(학생 등록 드롭다운 목록). */
export interface VipSubject {
  _id?: ObjectId;
  userId: ObjectId;
  name: string;
  order: number;
  createdAt: Date;
}

/** 학생 수강과목 + 과목별 수강료(선택). */
export interface VipStudentSubject {
  name: string;
  tuition?: number;
}

export interface VipSchool {
  _id?: ObjectId;
  userId: ObjectId;
  name: string;
  region?: string;
  neisCode?: string;
  /** 학교급 — 학생 학년 범위 결정. 미설정(기존 데이터)은 'high' 취급. */
  schoolLevel?: VipSchoolLevel;
  createdAt: Date;
}

export interface VipStudent {
  _id?: ObjectId;
  userId: ObjectId;
  schoolId: ObjectId;
  schoolName?: string;
  name: string;
  grade: number;
  academicYear: number;
  status: 'active' | 'inactive';
  examScope: string[];
  /** 수강과목 + 과목별 수강료(선택). 다과목 고도화로 추가. */
  subjects?: VipStudentSubject[];
  gender?: 'male' | 'female';
  memo?: string;
  phone?: string;
  parentPhone?: string;
  createdAt: Date;
  updatedAt?: Date;
}

export interface ExamQuestion {
  source?: string;
  textbook?: string;
  questionType?: string;
  questionText?: string;
  score: number;
  isSubjective: boolean;
}

export interface VipSchoolExam {
  _id?: ObjectId;
  userId: ObjectId;
  schoolId: ObjectId;
  academicYear: number;
  grade: number;
  examType: string;
  questions: Record<string, ExamQuestion>;
  objectiveCount: number;
  subjectiveCount: number;
  examScope: string[];
  examScopePassages?: string[];
  isLocked: boolean;
  pdfPath?: string;
  pdfUrl?: string;
  pdfName?: string;
  createdAt: Date;
  updatedAt?: Date;
}

export interface VipStudentScore {
  _id?: ObjectId;
  userId: ObjectId;
  studentId: ObjectId;
  schoolExamId: ObjectId;
  answers: Record<string, number>;
  objectiveScore: number;
  subjectiveScore: number;
  totalScore: number;
  createdAt: Date;
  updatedAt?: Date;
}

export interface VipExamPaper {
  _id?: ObjectId;
  userId: ObjectId;
  studentId: ObjectId;
  title: string;
  description?: string;
  questionIds: string[];
  objectiveCount: number;
  subjectiveCount: number;
  createdAt: Date;
  updatedAt?: Date;
}

/* ── DB 접근 ── */

let _indexesEnsured = false;

export async function getVipDb(): Promise<Db> {
  return getDb('gomijoshua');
}

export function col<T extends Document>(db: Db, name: keyof typeof COL): Collection<T> {
  return db.collection<T>(COL[name]);
}

export async function ensureVipIndexes(db: Db): Promise<void> {
  if (_indexesEnsured) return;
  _indexesEnsured = true;

  await Promise.all([
    db.collection(COL.schools).createIndex({ userId: 1, name: 1 }, { unique: true }),
    db.collection(COL.students).createIndex({ userId: 1, schoolId: 1 }),
    db.collection(COL.students).createIndex({ userId: 1, status: 1 }),
    db.collection(COL.schoolExams).createIndex(
      { userId: 1, schoolId: 1, academicYear: 1, grade: 1, examType: 1 },
      { unique: true },
    ),
    db.collection(COL.studentScores).createIndex(
      { studentId: 1, schoolExamId: 1 },
      { unique: true },
    ),
    db.collection(COL.examPapers).createIndex({ userId: 1, studentId: 1 }),
    db.collection(COL.subjects).createIndex({ userId: 1, name: 1 }, { unique: true }),
  ]);
}

/* ── 인증 헬퍼 ── */

export function toObjectId(id: string): ObjectId {
  return new ObjectId(id);
}
