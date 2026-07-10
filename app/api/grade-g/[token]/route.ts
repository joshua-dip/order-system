import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { normalizeCircledAnswer } from '@/lib/final-exam-store';
import {
  GRAMMAR_WORKSHEETS_COLLECTION, GRAMMAR_GRADINGS_COLLECTION,
  type GrammarWorksheet, type GrammarGrading,
} from '@/lib/vip-grammar-worksheet';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/grade-g/{token} — 채점용 문항 메타(객관식만, 정답 미노출). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = await getDb('gomijoshua');
  const w = await db.collection<GrammarWorksheet>(GRAMMAR_WORKSHEETS_COLLECTION).findOne({ gradeToken: token });
  if (!w) return NextResponse.json({ ok: false, error: '학습지를 찾을 수 없습니다.' }, { status: 404 });
  const questions = w.items
    .filter((it) => it.options && it.options.length > 0)
    .map((it) => ({ num: it.num, question: it.question, options: it.options }));
  return NextResponse.json({ ok: true, title: w.title, gradableCount: questions.length, questions });
}

/** POST /api/grade-g/{token} — 답안 제출·자동 채점. body { studentName, answers: {num: "①"} } */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = await request.json().catch(() => null) as { studentName?: unknown; answers?: unknown } | null;
  const studentName = String(body?.studentName ?? '').trim().slice(0, 40) || '학생';
  const answersIn = (body?.answers && typeof body.answers === 'object') ? body.answers as Record<string, unknown> : {};

  const db = await getDb('gomijoshua');
  const w = await db.collection<GrammarWorksheet>(GRAMMAR_WORKSHEETS_COLLECTION).findOne({ gradeToken: token });
  if (!w) return NextResponse.json({ ok: false, error: '학습지를 찾을 수 없습니다.' }, { status: 404 });

  const gradable = w.items.filter((it) => it.options && it.options.length > 0);
  const answers = gradable.map((it) => {
    const chosen = String(answersIn[String(it.num)] ?? '').trim();
    const isCorrect = !!chosen && normalizeCircledAnswer(chosen) === normalizeCircledAnswer(it.answer);
    return { num: it.num, chosen, correct: it.answer, isCorrect };
  });
  const score = answers.filter((a) => a.isCorrect).length;
  const total = gradable.length;

  const grading: GrammarGrading = {
    worksheetId: w._id as ObjectId, ownerUserId: w.userId, studentName,
    answers, score, total, createdAt: new Date(),
  };
  const r = await db.collection(GRAMMAR_GRADINGS_COLLECTION).insertOne(grading);

  // 결과 상세(정답·해설 공개 = 자가채점)
  const explMap = new Map(gradable.map((it) => [it.num, { question: it.question, options: it.options, explanation: it.explanation ?? '' }]));
  const results = answers.map((a) => ({ ...a, ...(explMap.get(a.num) ?? {}) }));
  return NextResponse.json({ ok: true, gradingId: String(r.insertedId), score, total, results });
}
