import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVipMenu } from '@/lib/vip-menu-guard';
import { getDb } from '@/lib/mongodb';
import {
  GRADE_PAPERS_COLLECTION,
  GRADE_RESULTS_COLLECTION,
  type GradePaperDoc,
  type GradeResultDoc,
} from '@/lib/vip-grade-store';
import { previewText } from '@/lib/vip-question-bank-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/my/vip/review?paperId=&resultId=
 * 한 학생의 QR 채점 결과 → 틀린 문항(본문 조인) + 약점 유형 + 약점 유형의 신규 변형(약점 재시험용).
 */
export async function GET(request: NextRequest) {
  const auth = await requireVipMenu(request, 'review');
  if (auth instanceof NextResponse) return auth;

  const sp = request.nextUrl.searchParams;
  const paperId = sp.get('paperId');
  const resultId = sp.get('resultId');
  if (!paperId || !ObjectId.isValid(paperId) || !resultId || !ObjectId.isValid(resultId)) {
    return NextResponse.json({ error: 'paperId·resultId 가 필요합니다.' }, { status: 400 });
  }

  const db = await getDb('gomijoshua');
  const userId = new ObjectId(auth.userId);

  const paper = await db.collection<GradePaperDoc>(GRADE_PAPERS_COLLECTION).findOne({ _id: new ObjectId(paperId), userId });
  if (!paper) return NextResponse.json({ error: '시험지를 찾을 수 없습니다.' }, { status: 404 });
  const result = await db.collection<GradeResultDoc>(GRADE_RESULTS_COLLECTION).findOne({ _id: new ObjectId(resultId), userId, paperId: paper._id });
  if (!result) return NextResponse.json({ error: '응시 기록을 찾을 수 없습니다.' }, { status: 404 });

  // num → 시험지 문항(원본 questionId 등)
  const qByNum = new Map<number, GradePaperDoc['questions'][number]>();
  for (const q of paper.questions) qByNum.set(q.num, q);

  const wrongAnswers = result.answers.filter((a) => !a.isCorrect);
  const wrongQids = wrongAnswers
    .map((a) => qByNum.get(a.num)?.questionId)
    .filter((x): x is string => !!x && ObjectId.isValid(x))
    .map((x) => new ObjectId(x));

  // 틀린 문항 본문 조인
  const contentById = new Map<string, { question: string; paragraph: string; explanation: string }>();
  if (wrongQids.length > 0) {
    const docs = await db.collection('generated_questions')
      .find({ _id: { $in: wrongQids } })
      .project({ 'question_data.Question': 1, 'question_data.Paragraph': 1, 'question_data.Explanation': 1 })
      .toArray();
    for (const d of docs) {
      const qd = (d.question_data ?? {}) as { Question?: string; Paragraph?: string; Explanation?: string };
      contentById.set(String(d._id), {
        question: previewText(qd.Question, 120),
        paragraph: previewText(qd.Paragraph, 160),
        explanation: previewText(qd.Explanation, 200),
      });
    }
  }

  const wrong = wrongAnswers.map((a) => {
    const pq = qByNum.get(a.num);
    const qid = pq?.questionId ?? '';
    const c = contentById.get(qid);
    return {
      num: a.num,
      type: a.type,
      sourceKey: a.sourceKey,
      textbook: pq?.textbook ?? '',
      category: a.category,
      score: a.score,
      chosen: a.chosen,
      correct: a.correct,
      questionId: qid,
      question: c?.question ?? '',
      paragraph: c?.paragraph ?? '',
      explanation: c?.explanation ?? '',
    };
  });

  // 약점 유형 (정답률 낮은 순)
  const weakTypes = result.byType
    .filter((t) => t.correct < t.total)
    .map((t) => ({ type: t.type, correct: t.correct, total: t.total, pct: t.total > 0 ? Math.round((t.correct / t.total) * 100) : 0 }))
    .sort((a, b) => a.pct - b.pct);

  // 약점 재시험 — 약점 유형별로 같은 교재의 신규 변형 추출(이미 출제된 문항 제외), 유형당 최대 2개
  const paperTextbooks = [...new Set(paper.questions.map((q) => q.textbook).filter(Boolean))];
  const usedIds = new Set(paper.questions.map((q) => q.questionId));
  const retest: { questionId: string; type: string; textbook: string; sourceKey: string }[] = [];
  for (const wt of weakTypes) {
    const sampled = await db.collection('generated_questions').aggregate([
      { $match: { status: '완료', type: wt.type, textbook: { $in: paperTextbooks } } },
      { $sample: { size: 6 } },
      { $project: { type: 1, textbook: 1, source_key: 1 } },
    ]).toArray();
    let picked = 0;
    for (const s of sampled) {
      const sid = String(s._id);
      if (usedIds.has(sid) || retest.some((r) => r.questionId === sid)) continue;
      retest.push({ questionId: sid, type: String(s.type ?? wt.type), textbook: String(s.textbook ?? ''), sourceKey: String(s.source_key ?? '') });
      usedIds.add(sid);
      if (++picked >= 2) break;
    }
  }

  return NextResponse.json({
    ok: true,
    student: {
      name: result.studentName,
      correctCount: result.correctCount,
      objectiveCount: result.objectiveCount,
      earnedScore: result.earnedScore,
      maxObjectiveScore: result.maxObjectiveScore,
    },
    paperTitle: paper.title,
    schoolName: paper.schoolName ?? '',
    grade: paper.grade ?? null,
    wrong,
    weakTypes,
    retest,
  });
}
