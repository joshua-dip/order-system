import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVipMenu } from '@/lib/vip-menu-guard';
import { getDb } from '@/lib/mongodb';
import { publicBaseUrl } from '@/lib/public-base-url';
import { MATH_PROBLEMS_COLLECTION, formatMathSerial, difficultyRank } from '@/lib/vip-math-problem-bank';
import {
  MATH_GRADE_PAPERS_COLLECTION,
  generateGradeToken,
  type MathGradePaperDoc,
  type MathGradePaperQuestion,
} from '@/lib/vip-math-grade-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DIFFICULTY_SCORE: Record<string, number> = { 기본: 4, 중: 5, 고: 6 };

/**
 * POST — 선택 진도(topicKey)의 문제로 QR 자가채점 채점지(토큰) 생성.
 * body: { topicKey, title?, source?, problemIds?: string[] (인쇄 순서 고정용) }
 * 반환: { token, url }  (url = /math-grade/{token})
 */
export async function POST(request: NextRequest) {
  const auth = await requireVipMenu(request, 'math-problems');
  if (auth instanceof NextResponse) return auth;

  let body: { topicKey?: unknown; title?: unknown; source?: unknown; problemIds?: unknown };
  try { body = (await request.json()) as Record<string, unknown>; }
  catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }); }

  const topicKey = String(body.topicKey ?? '').trim();
  if (!topicKey) return NextResponse.json({ error: 'topicKey 가 필요합니다.' }, { status: 400 });
  const source = String(body.source ?? '').trim();
  const orderedIds = Array.isArray(body.problemIds)
    ? body.problemIds.filter((x): x is string => typeof x === 'string' && ObjectId.isValid(x))
    : [];

  const db = await getDb('gomijoshua');
  const userId = new ObjectId(auth.userId);
  const col = db.collection(MATH_PROBLEMS_COLLECTION);

  const match: Record<string, unknown> = { userId, topicKey };
  if (source) match.source = source;
  const docs = await col.find(match).limit(500).toArray();
  if (docs.length === 0) return NextResponse.json({ error: '이 진도에 저장된 문제가 없습니다.' }, { status: 404 });

  // 인쇄 순서(problemIds) 우선, 없으면 난도·번호·일련번호 순 (문제 목록/인쇄와 동일)
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  const ordered = orderedIds.length
    ? orderedIds.map((id) => byId.get(id)).filter((d): d is NonNullable<typeof d> => !!d)
    : docs.sort(
        (a, b) =>
          difficultyRank(a.difficulty) - difficultyRank(b.difficulty) ||
          (a.no ?? 0) - (b.no ?? 0) ||
          (a.serialNo ?? 0) - (b.serialNo ?? 0),
      );
  if (ordered.length === 0) return NextResponse.json({ error: '문항 구성에 실패했습니다.' }, { status: 400 });

  const questions: MathGradePaperQuestion[] = ordered.map((d, i) => {
    const type = String(d.type ?? '주관식');
    return {
      num: i + 1,
      problemId: String(d._id),
      serial: formatMathSerial(d.serialNo),
      topicKey: String(d.topicKey ?? topicKey),
      학습주제: String(d.학습주제 ?? ''),
      difficulty: String(d.difficulty ?? '기본'),
      type,
      question: String(d.question ?? ''),
      ...(Array.isArray(d.choices) && d.choices.length ? { choices: d.choices as string[] } : {}),
      correctAnswer: String(d.answer ?? '').trim(),
      score: DIFFICULTY_SCORE[String(d.difficulty ?? '기본')] ?? 4,
    };
  });

  const objectiveCount = questions.filter((q) => q.type === '객관식').length;
  const subjectiveCount = questions.length - objectiveCount;
  const maxScore = questions.reduce((s, q) => s + (Number(q.score) || 0), 0);
  const segs = topicKey.split(' > ');
  const 교과 = segs[0] ?? '';
  const 학습주제 = segs[segs.length - 1] ?? '';
  const title = String(body.title ?? '').trim() || 학습주제 || '수학 문제';

  const token = generateGradeToken();
  const doc: MathGradePaperDoc = {
    userId, token, title, 교과, topicKey, 학습주제,
    questions, objectiveCount, subjectiveCount, maxScore,
    createdAt: new Date(),
  };
  await db.collection<MathGradePaperDoc>(MATH_GRADE_PAPERS_COLLECTION).insertOne(doc);

  return NextResponse.json({
    ok: true,
    token,
    url: `${publicBaseUrl(request)}/math-grade/${token}`,
    count: questions.length,
    objectiveCount,
    subjectiveCount,
  });
}
