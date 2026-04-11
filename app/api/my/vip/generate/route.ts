import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVip } from '@/lib/vip-auth';
import { getVipDb, col, type VipStudent } from '@/lib/vip-db';
import { getDb } from '@/lib/mongodb';

export async function GET(request: NextRequest) {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;

  const sp = request.nextUrl.searchParams;
  const studentId = sp.get('studentId');
  const textbook = sp.get('textbook');
  const type = sp.get('type');
  const difficulty = sp.get('difficulty');
  const limit = Math.min(100, Math.max(1, Number(sp.get('limit') || '20')));
  const random = sp.get('random') === 'true';

  const db = await getDb('gomijoshua');
  const vipDb = await getVipDb();

  let examScope: string[] = [];
  if (studentId) {
    const student = await col<VipStudent>(vipDb, 'students').findOne({
      _id: new ObjectId(studentId),
      userId: new ObjectId(auth.userId),
    });
    if (student?.examScope?.length) {
      examScope = student.examScope;
    }
  }

  const filter: Record<string, unknown> = { status: '완료' };
  if (textbook) {
    filter.textbook = textbook;
  } else if (examScope.length > 0) {
    filter.textbook = { $in: examScope };
  }
  if (type) filter.type = type;
  if (difficulty) filter.difficulty = difficulty;

  let questions;
  if (random) {
    questions = await db.collection('generated_questions')
      .aggregate([
        { $match: filter },
        { $sample: { size: limit } },
        {
          $project: {
            textbook: 1, passageId: 1, type: 1, difficulty: 1,
            'question_data.Paragraph': 1,
            'question_data.Options': 1,
            'question_data.Answer': 1,
            'question_data.Explanation': 1,
            pric: 1,
          },
        },
      ])
      .toArray();
  } else {
    questions = await db.collection('generated_questions')
      .find(filter)
      .project({
        textbook: 1, passageId: 1, type: 1, difficulty: 1,
        'question_data.Paragraph': 1,
        'question_data.Options': 1,
        'question_data.Answer': 1,
        'question_data.Explanation': 1,
        pric: 1,
      })
      .limit(limit)
      .toArray();
  }

  return NextResponse.json({
    ok: true,
    total: questions.length,
    questions: questions.map((q) => ({
      id: q._id.toString(),
      textbook: q.textbook,
      passageId: q.passageId,
      type: q.type,
      difficulty: q.difficulty,
      paragraph: q.question_data?.Paragraph ?? '',
      options: q.question_data?.Options ?? '',
      answer: q.question_data?.Answer ?? '',
      explanation: q.question_data?.Explanation ?? '',
      pric: q.pric ?? null,
    })),
  });
}
