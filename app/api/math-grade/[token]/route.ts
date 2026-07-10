import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import {
  MATH_GRADE_RESULTS_COLLECTION,
  ensureMathGradeIndexes,
  getMathGradePaperByToken,
  gradeMathPaper,
  computeSelfScore,
  normalizePhone,
  type MathGradeResultDoc,
  type MathGradeAnswer,
} from '@/lib/vip-math-grade-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* 학생 자가채점 — 비로그인 공개 (토큰 = 채점지 1장 권한). */

/** 채점지 메타 + 문항(문제·선택지, 정답 미포함). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const db = await getDb('gomijoshua');
    const paper = await getMathGradePaperByToken(db, token);
    if (!paper) return NextResponse.json({ error: '유효하지 않은 채점지입니다.' }, { status: 404 });
    return NextResponse.json({
      ok: true,
      title: paper.title,
      교과: paper.교과 ?? '',
      학습주제: paper.학습주제 ?? '',
      objectiveCount: paper.objectiveCount,
      subjectiveCount: paper.subjectiveCount,
      maxScore: paper.maxScore,
      questions: paper.questions.map((q) => ({
        num: q.num, type: q.type, difficulty: q.difficulty,
        question: q.question, choices: q.choices ?? undefined,
      })),
    });
  } catch (e) {
    console.error('[math-grade GET]', e);
    return NextResponse.json({ error: '채점지 정보를 불러오지 못했습니다.' }, { status: 500 });
  }
}

/** 전화번호 본인 확인 → 답안 제출 → 자동 채점 → 저장·반환(정답 공개). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let body: { phone?: unknown; answers?: unknown };
  try { body = (await request.json()) as Record<string, unknown>; }
  catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }); }

  const phone = normalizePhone(typeof body.phone === 'string' ? body.phone : '');
  if (phone.length < 8) return NextResponse.json({ error: '전화번호를 정확히 입력해주세요.' }, { status: 400 });
  const rawAnswers = Array.isArray(body.answers) ? body.answers : [];

  try {
    const db = await getDb('gomijoshua');
    const paper = await getMathGradePaperByToken(db, token);
    if (!paper) return NextResponse.json({ error: '유효하지 않은 채점지입니다.' }, { status: 404 });

    // 등록된 학생만 — 선생님(paper.userId) 명단에서 전화번호 매칭
    const students = await db.collection('vip_students').find({ userId: paper.userId }).project({ name: 1, phone: 1 }).toArray();
    const student = students.find((s) => normalizePhone(String(s.phone ?? '')) === phone);
    if (!student) return NextResponse.json({ error: '등록되지 않은 전화번호입니다. 선생님께 문의하세요.' }, { status: 403 });

    const chosenByNum = new Map<number, string>();
    for (const a of rawAnswers) {
      const num = typeof (a as { num?: unknown })?.num === 'number' ? (a as { num: number }).num : NaN;
      const chosen = String((a as { chosen?: unknown })?.chosen ?? '');
      if (Number.isInteger(num)) chosenByNum.set(num, chosen);
    }

    await ensureMathGradeIndexes(db);
    const graded = gradeMathPaper(paper, chosenByNum);

    const doc: MathGradeResultDoc = {
      paperId: paper._id as ObjectId,
      userId: paper.userId,
      token: paper.token,
      studentId: student._id as ObjectId,
      studentName: String(student.name ?? ''),
      studentPhone: phone,
      ...graded,
      createdAt: new Date(),
    };

    // 첫 제출만 공식 기록 — 재제출은 retake 로.
    let isFirst = false;
    try {
      const upd = await db.collection(MATH_GRADE_RESULTS_COLLECTION).updateOne(
        { paperId: paper._id, studentId: student._id },
        { $setOnInsert: doc },
        { upsert: true },
      );
      isFirst = !!upd.upsertedId;
    } catch (e) {
      if ((e as { code?: number }).code !== 11000) throw e;
    }

    const wrongNums = graded.answers.filter((a) => !a.isCorrect).map((a) => a.num);
    const weakTopics = graded.byTopic.filter((t) => t.correct < t.total).map((t) => t.학습주제);

    let official: { correctCount: number; totalCount: number; earnedScore: number; maxScore: number } | undefined;
    if (!isFirst) {
      const existing = await db.collection<MathGradeResultDoc>(MATH_GRADE_RESULTS_COLLECTION).findOne({ paperId: paper._id, studentId: student._id });
      if (existing) {
        official = { correctCount: existing.correctCount, totalCount: existing.totalCount, earnedScore: existing.earnedScore, maxScore: existing.maxScore };
        const retake = {
          attemptCount: (existing.retake?.attemptCount ?? 0) + 1,
          correctCount: graded.correctCount,
          totalCount: graded.totalCount,
          earnedScore: graded.earnedScore,
          maxScore: graded.maxScore,
          wrongNums,
          createdAt: new Date(),
        };
        await db.collection(MATH_GRADE_RESULTS_COLLECTION).updateOne(
          { paperId: paper._id, studentId: student._id },
          { $set: { retake } },
        );
      }
    }

    return NextResponse.json({
      ok: true,
      isRetake: !isFirst,
      studentName: doc.studentName,
      correctCount: graded.correctCount,
      totalCount: graded.totalCount,
      earnedScore: graded.earnedScore,
      maxScore: graded.maxScore,
      weakTopics,
      wrongNums,
      // 결과 화면: 문항별 채점 + 정답 공개 (주관식 자가채점용)
      answers: graded.answers.map((a) => ({
        num: a.num, type: a.type, chosen: a.chosen, correct: a.correct,
        isCorrect: a.isCorrect, needsSelfCheck: a.needsSelfCheck, score: a.score,
      })),
      ...(official ? { official } : {}),
    });
  } catch (e) {
    console.error('[math-grade POST]', e);
    return NextResponse.json({ error: '채점 처리에 실패했습니다.' }, { status: 500 });
  }
}

/** 자가채점(O/X) 반영 — 주관식 자동 오답을 학생이 정답 처리. 공식 자동점수는 불변, self* 만 갱신. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let body: { phone?: unknown; selfMarks?: unknown };
  try { body = (await request.json()) as Record<string, unknown>; }
  catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }); }

  const phone = normalizePhone(typeof body.phone === 'string' ? body.phone : '');
  if (phone.length < 8) return NextResponse.json({ error: '전화번호 오류' }, { status: 400 });
  const marks = (body.selfMarks && typeof body.selfMarks === 'object') ? body.selfMarks as Record<string, unknown> : {};

  try {
    const db = await getDb('gomijoshua');
    const paper = await getMathGradePaperByToken(db, token);
    if (!paper) return NextResponse.json({ error: '유효하지 않은 채점지입니다.' }, { status: 404 });
    const result = await db.collection<MathGradeResultDoc>(MATH_GRADE_RESULTS_COLLECTION)
      .findOne({ paperId: paper._id, studentPhone: phone });
    if (!result) return NextResponse.json({ error: '채점 기록을 찾을 수 없습니다.' }, { status: 404 });

    // 주관식 + needsSelfCheck 인 문항만 자가채점 허용
    const answers: MathGradeAnswer[] = (result.answers ?? []).map((a) => {
      if (a.type === '주관식' && a.needsSelfCheck && Object.prototype.hasOwnProperty.call(marks, String(a.num))) {
        return { ...a, selfMarked: marks[String(a.num)] === true };
      }
      return a;
    });
    const { selfCorrectCount, selfEarnedScore } = computeSelfScore(answers);
    await db.collection(MATH_GRADE_RESULTS_COLLECTION).updateOne(
      { _id: result._id },
      { $set: { answers, selfCorrectCount, selfEarnedScore } },
    );
    return NextResponse.json({ ok: true, selfCorrectCount, selfEarnedScore, maxScore: result.maxScore, totalCount: result.totalCount });
  } catch (e) {
    console.error('[math-grade PATCH]', e);
    return NextResponse.json({ error: '자가채점 반영에 실패했습니다.' }, { status: 500 });
  }
}
