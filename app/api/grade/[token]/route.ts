import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import {
  FINAL_EXAM_GRADINGS_COLLECTION,
  getFinalExamJobByToken,
  loadExamQuestions,
  normalizeCircledAnswer,
  refillJobShortages,
  type FinalExamGradingAnswer,
} from '@/lib/final-exam-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** QR 채점 — 비로그인 공개 (토큰 = 시험지 1장 단위 권한) */

async function viewerLoginId(request: NextRequest): Promise<string | null> {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const payload = await verifyToken(token);
  return payload?.loginId ?? null;
}

/** 시험 메타 + OMR 입력에 필요한 문항 목록 (정답 미포함) */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  try {
    const db = await getDb('gomijoshua');
    let job = await getFinalExamJobByToken(db, token);
    if (!job) return NextResponse.json({ error: '유효하지 않은 시험지입니다.' }, { status: 404 });
    if (job.status === 'awaiting_admin') job = await refillJobShortages(db, job);
    if (job.status !== 'ready') {
      return NextResponse.json({ error: '아직 제작 중인 시험지입니다. 완성 후 채점할 수 있습니다.' }, { status: 409 });
    }

    const questions = await loadExamQuestions(db, job);
    const viewer = await viewerLoginId(request);
    return NextResponse.json({
      title: job.title,
      scopeSummary: job.scopeSummary,
      total: questions.length,
      isOwner: viewer != null && viewer === job.loginId,
      questions: questions.map((q) => ({
        num: q.num,
        type: q.type,
        /* 어법-고난도는 「모두 고르시오」 → 복수 선택 */
        multi: q.type === '어법-고난도',
      })),
    });
  } catch (e) {
    console.error('[grade GET]', e);
    return NextResponse.json({ error: '시험 정보를 불러오지 못했습니다.' }, { status: 500 });
  }
}

/** 답안 제출 → 자동 채점 → 기록 저장 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  let body: { studentName?: unknown; answers?: unknown };
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 });
  }
  const studentName = typeof body.studentName === 'string' ? body.studentName.trim().slice(0, 40) : '';
  if (!studentName) return NextResponse.json({ error: '이름을 입력해주세요.' }, { status: 400 });
  const rawAnswers = Array.isArray(body.answers) ? body.answers : [];

  try {
    const db = await getDb('gomijoshua');
    const job = await getFinalExamJobByToken(db, token);
    if (!job) return NextResponse.json({ error: '유효하지 않은 시험지입니다.' }, { status: 404 });
    if (job.status !== 'ready') {
      return NextResponse.json({ error: '아직 제작 중인 시험지입니다.' }, { status: 409 });
    }

    const questions = await loadExamQuestions(db, job);
    const chosenByNum = new Map<number, string>();
    for (const a of rawAnswers) {
      const num = typeof (a as { num?: unknown })?.num === 'number' ? (a as { num: number }).num : NaN;
      const chosen = normalizeCircledAnswer(String((a as { chosen?: unknown })?.chosen ?? ''));
      if (Number.isInteger(num)) chosenByNum.set(num, chosen);
    }

    const answers: FinalExamGradingAnswer[] = [];
    const byType = new Map<string, { correct: number; total: number }>();
    const bySource = new Map<string, { correct: number; total: number }>();
    let score = 0;
    for (const q of questions) {
      const chosen = chosenByNum.get(q.num) ?? '';
      const correct = normalizeCircledAnswer(q.correctAnswer);
      const isCorrect = chosen.length > 0 && chosen === correct;
      if (isCorrect) score += 1;
      answers.push({
        num: q.num,
        questionId: new ObjectId(q.questionId && ObjectId.isValid(q.questionId) ? q.questionId : '0'.repeat(24)),
        type: q.type,
        sourceKey: q.sourceKey,
        chosen,
        correct,
        isCorrect,
      });
      const t = byType.get(q.type) ?? { correct: 0, total: 0 };
      t.total += 1; if (isCorrect) t.correct += 1; byType.set(q.type, t);
      const s = bySource.get(q.sourceKey) ?? { correct: 0, total: 0 };
      s.total += 1; if (isCorrect) s.correct += 1; bySource.set(q.sourceKey, s);
    }

    const doc = {
      jobId: job._id,
      ownerLoginId: job.loginId,
      studentName,
      answers,
      score,
      total: questions.length,
      byType: [...byType.entries()].map(([type, v]) => ({ type, ...v })),
      bySource: [...bySource.entries()].map(([sourceKey, v]) => ({ sourceKey, ...v })),
      createdAt: new Date(),
    };
    const r = await db.collection(FINAL_EXAM_GRADINGS_COLLECTION).insertOne(doc);

    return NextResponse.json({ ok: true, gradingId: String(r.insertedId), score, total: questions.length });
  } catch (e) {
    console.error('[grade POST]', e);
    return NextResponse.json({ error: '채점 처리에 실패했습니다.' }, { status: 500 });
  }
}
