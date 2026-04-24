import { getDb } from '@/lib/mongodb';

const COLLECTION = 'student_attempts';

export type StudentAttempt = {
  studentLoginId: string;
  questionData: Record<string, unknown>;
  questionType: string;
  studentAnswer: string;
  isCorrect: boolean;
  aiFeedback: string;
  attemptAt: Date;
  timeSpentMs?: number;
};

export async function recordAttempt(attempt: Omit<StudentAttempt, 'attemptAt'>): Promise<void> {
  const db = await getDb('gomijoshua');
  await db.collection(COLLECTION).insertOne({ ...attempt, attemptAt: new Date() });

  // 누적 통계 업데이트
  const inc: Record<string, number> = { 'studentMeta.totalAttempts': 1 };
  if (attempt.isCorrect) inc['studentMeta.correctAttempts'] = 1;
  await db.collection('users').updateOne(
    { loginId: attempt.studentLoginId, role: 'student' },
    { $inc: inc, $set: { 'studentMeta.lastPracticeAt': new Date(), updatedAt: new Date() } }
  );
}

export async function listAttempts(studentLoginId: string, limit = 30): Promise<StudentAttempt[]> {
  const db = await getDb('gomijoshua');
  return db
    .collection<StudentAttempt>(COLLECTION)
    .find({ studentLoginId })
    .sort({ attemptAt: -1 })
    .limit(limit)
    .toArray();
}
