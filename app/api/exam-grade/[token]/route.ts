import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import {
  GRADE_RESULTS_COLLECTION,
  getGradePaperByToken,
  gradePaper,
  normalizeCircledAnswer,
  normalizePhone,
  type GradeResultDoc,
} from '@/lib/vip-grade-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* 학생 자가채점 — 비로그인 공개 (토큰 = 시험지 1장 권한). 정답은 응답에 절대 미포함. */

/** 시험 메타 + OMR 입력에 필요한 문항 목록 (정답 미포함) */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const db = await getDb('gomijoshua');
    const paper = await getGradePaperByToken(db, token);
    if (!paper) return NextResponse.json({ error: '유효하지 않은 시험지입니다.' }, { status: 404 });
    return NextResponse.json({
      ok: true,
      title: paper.title,
      schoolName: paper.schoolName ?? '',
      grade: paper.grade ?? null,
      objectiveCount: paper.objectiveCount,
      subjectiveCount: paper.subjectiveCount,
      maxObjectiveScore: paper.maxObjectiveScore,
      // 채점은 객관식만. 번호+유형만 노출(정답 X).
      questions: paper.questions.map((q) => ({ num: q.num, type: q.type })),
    });
  } catch (e) {
    console.error('[exam-grade GET]', e);
    return NextResponse.json({ error: '시험 정보를 불러오지 못했습니다.' }, { status: 500 });
  }
}

/** 전화번호 본인 확인 → 답안 제출 → 자동 채점 → 결과 저장·반환 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let body: { phone?: unknown; answers?: unknown };
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 });
  }
  const phone = normalizePhone(typeof body.phone === 'string' ? body.phone : '');
  if (phone.length < 8) return NextResponse.json({ error: '전화번호를 정확히 입력해주세요.' }, { status: 400 });
  const rawAnswers = Array.isArray(body.answers) ? body.answers : [];

  try {
    const db = await getDb('gomijoshua');
    const paper = await getGradePaperByToken(db, token);
    if (!paper) return NextResponse.json({ error: '유효하지 않은 시험지입니다.' }, { status: 404 });

    // 등록된 학생만 — 선생님(paper.userId) 명단에서 전화번호 매칭
    const students = await db
      .collection('vip_students')
      .find({ userId: paper.userId })
      .project({ name: 1, phone: 1 })
      .toArray();
    const student = students.find((s) => normalizePhone(String(s.phone ?? '')) === phone);
    if (!student) {
      return NextResponse.json({ error: '등록되지 않은 전화번호입니다. 선생님께 문의하세요.' }, { status: 403 });
    }

    const chosenByNum = new Map<number, string>();
    for (const a of rawAnswers) {
      const num = typeof (a as { num?: unknown })?.num === 'number' ? (a as { num: number }).num : NaN;
      const chosen = normalizeCircledAnswer(String((a as { chosen?: unknown })?.chosen ?? ''));
      if (Number.isInteger(num)) chosenByNum.set(num, chosen);
    }

    const graded = gradePaper(paper, chosenByNum);

    const doc: GradeResultDoc = {
      paperId: paper._id as ObjectId,
      userId: paper.userId,
      token: paper.token,
      studentId: student._id as ObjectId,
      studentName: String(student.name ?? ''),
      studentPhone: phone,
      ...graded,
      createdAt: new Date(),
    };
    // 같은 학생이 같은 시험지 재제출 → 최신으로 갱신
    await db.collection(GRADE_RESULTS_COLLECTION).updateOne(
      { paperId: paper._id, studentId: student._id },
      { $set: doc },
      { upsert: true },
    );

    // 학생에게 보여줄 복습 추천 (정답 자체는 노출 X)
    const weakTypes = graded.byType.filter((t) => t.correct < t.total).sort((a, b) => a.correct / a.total - b.correct / b.total).map((t) => t.type);
    const wrongNums = graded.answers.filter((a) => !a.isCorrect).map((a) => a.num);

    return NextResponse.json({
      ok: true,
      studentName: doc.studentName,
      correctCount: graded.correctCount,
      objectiveCount: graded.objectiveCount,
      earnedScore: graded.earnedScore,
      maxObjectiveScore: graded.maxObjectiveScore,
      weakTypes,
      wrongNums,
    });
  } catch (e) {
    console.error('[exam-grade POST]', e);
    return NextResponse.json({ error: '채점 처리에 실패했습니다.' }, { status: 500 });
  }
}
