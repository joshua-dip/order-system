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
  const setsCount = Math.min(5, Math.max(1, Number(sp.get('sets') || '1')));

  const db = await getDb('gomijoshua');
  const vipDb = await getVipDb();

  let examScope: string[] = [];
  if (studentId) {
    const student = await col<VipStudent>(vipDb, 'students').findOne({
      _id: new ObjectId(studentId),
      userId: new ObjectId(auth.userId),
    });
    if (student?.examScope?.length) examScope = student.examScope;
  }

  const buildFilter = (excludeIds: ObjectId[] = []): Record<string, unknown> => {
    const f: Record<string, unknown> = { status: '완료' };
    if (textbook) f.textbook = textbook;
    else if (examScope.length > 0) f.textbook = { $in: examScope };
    if (type) f.type = type;
    if (difficulty) f.difficulty = difficulty;
    if (excludeIds.length === 0) return f;
    return { $and: [f, { _id: { $nin: excludeIds } }] };
  };

  const project = {
    textbook: 1, passageId: 1, type: 1, difficulty: 1,
    'question_data.Paragraph': 1, 'question_data.Options': 1,
    'question_data.Answer': 1, 'question_data.Explanation': 1, pric: 1,
  };

  const mapQ = (q: Record<string, unknown>) => ({
    id: (q._id as ObjectId).toString(),
    textbook: q.textbook,
    passageId: q.passageId ?? null,
    type: q.type,
    difficulty: q.difficulty,
    paragraph: (q.question_data as Record<string, unknown>)?.Paragraph ?? '',
    options: (q.question_data as Record<string, unknown>)?.Options ?? '',
    answer: (q.question_data as Record<string, unknown>)?.Answer ?? '',
    explanation: (q.question_data as Record<string, unknown>)?.Explanation ?? '',
    pric: q.pric ?? null,
  });

  const resultSets: ReturnType<typeof mapQ>[][] = [];
  const globalUsedIds = new Set<string>();

  for (let s = 0; s < setsCount; s++) {
    const excludeOids = [...globalUsedIds].map((h) => new ObjectId(h));
    const filter = buildFilter(excludeOids);

    const qs = random
      ? await db.collection('generated_questions').aggregate([{ $match: filter }, { $sample: { size: limit } }, { $project: project }]).toArray()
      : await db.collection('generated_questions').find(filter).project(project).limit(limit).toArray();

    for (const q of qs) globalUsedIds.add((q._id as ObjectId).toHexString());
    resultSets.push(qs.map(mapQ));
  }

  return NextResponse.json({ ok: true, sets: resultSets });
}
