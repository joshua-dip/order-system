import { getDb } from '@/lib/mongodb';
import { getStudentAiConfig } from '@/lib/student-ai-config';

const COLLECTION = 'student_ai_usage';

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function startOfWeek(d: Date): Date {
  const day = d.getDay(); // 0=Sun
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Mon-based
  const mon = new Date(d.getFullYear(), d.getMonth(), diff);
  return new Date(mon.getFullYear(), mon.getMonth(), mon.getDate());
}

function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, -1);
}

function endOfWeek(d: Date): Date {
  const weekStart = startOfWeek(d);
  return new Date(weekStart.getTime() + 7 * 86400000 - 1);
}

export async function checkQuota(
  studentLoginId: string
): Promise<
  | { ok: true; dayUsed: number; weekUsed: number; dailyLimit: number; weeklyLimit: number }
  | { ok: false; reason: 'daily' | 'weekly'; resetAt: Date; dailyLimit: number; weeklyLimit: number }
> {
  const cfg = getStudentAiConfig();
  const db = await getDb('gomijoshua');
  const col = db.collection(COLLECTION);
  const now = new Date();
  const dayStart = startOfDay(now);
  const weekStart = startOfWeek(now);

  const [dayCount, weekCount] = await Promise.all([
    col.countDocuments({ studentLoginId, at: { $gte: dayStart }, ok: true }),
    col.countDocuments({ studentLoginId, at: { $gte: weekStart }, ok: true }),
  ]);

  if (dayCount >= cfg.dailyLimit) {
    return { ok: false, reason: 'daily', resetAt: endOfDay(now), dailyLimit: cfg.dailyLimit, weeklyLimit: cfg.weeklyLimit };
  }
  if (weekCount >= cfg.weeklyLimit) {
    return { ok: false, reason: 'weekly', resetAt: endOfWeek(now), dailyLimit: cfg.dailyLimit, weeklyLimit: cfg.weeklyLimit };
  }
  return { ok: true, dayUsed: dayCount, weekUsed: weekCount, dailyLimit: cfg.dailyLimit, weeklyLimit: cfg.weeklyLimit };
}

export async function recordUsage(params: {
  studentLoginId: string;
  kind: 'generate' | 'grade';
  ok: boolean;
  questionType?: string;
  inputTokens?: number;
  outputTokens?: number;
  errorMessage?: string;
}): Promise<void> {
  try {
    const db = await getDb('gomijoshua');
    await db.collection(COLLECTION).insertOne({
      studentLoginId: params.studentLoginId,
      kind: params.kind,
      at: new Date(),
      ok: params.ok,
      questionType: params.questionType,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      errorMessage: params.errorMessage,
    });
  } catch {
    // 쿼터 기록 실패는 무시 (응답에 영향 주지 않음)
  }
}

export async function getQuotaSummary(studentLoginId: string) {
  const cfg = getStudentAiConfig();
  const db = await getDb('gomijoshua');
  const col = db.collection(COLLECTION);
  const now = new Date();
  const dayStart = startOfDay(now);
  const weekStart = startOfWeek(now);
  const [dayUsed, weekUsed] = await Promise.all([
    col.countDocuments({ studentLoginId, at: { $gte: dayStart }, ok: true }),
    col.countDocuments({ studentLoginId, at: { $gte: weekStart }, ok: true }),
  ]);
  return {
    dayUsed,
    weekUsed,
    dailyLimit: cfg.dailyLimit,
    weeklyLimit: cfg.weeklyLimit,
    dayRemaining: Math.max(0, cfg.dailyLimit - dayUsed),
    weekRemaining: Math.max(0, cfg.weeklyLimit - weekUsed),
    resetAt: endOfDay(now).toISOString(),
  };
}
