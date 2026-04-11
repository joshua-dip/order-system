import { ObjectId, type Db, type Collection, type WithId, type Document } from 'mongodb';
import { getDb } from './mongodb';

/* ── 컬렉션 이름 ── */
const COL = {
  schools: 'vip_schools',
  students: 'vip_students',
  schoolExams: 'vip_school_exams',
  studentScores: 'vip_student_scores',
  examPapers: 'vip_exam_papers',
} as const;

/* ── 인터페이스 ── */

export interface VipSchool {
  _id?: ObjectId;
  userId: ObjectId;
  name: string;
  region?: string;
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
  memo?: string;
  phone?: string;
  parentPhone?: string;
  createdAt: Date;
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
  isLocked: boolean;
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
  ]);
}

/* ── 인증 헬퍼 ── */

export function toObjectId(id: string): ObjectId {
  return new ObjectId(id);
}
