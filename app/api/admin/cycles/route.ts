import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { CYCLES_COLLECTION, type ExamCycleDoc } from '@/lib/exam-cycles-store';
import { ObjectId } from 'mongodb';

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const db = await getDb('gomijoshua');
  const docs = await db
    .collection<ExamCycleDoc>(CYCLES_COLLECTION)
    .find({})
    .sort({ createdAt: -1 })
    .toArray();

  const enrollmentCounts = await db
    .collection('enrollments')
    .aggregate([
      { $match: { status: { $in: ['pending_payment', 'active'] } } },
      { $group: { _id: '$cycleId', count: { $sum: 1 } } },
    ])
    .toArray();
  const countMap = Object.fromEntries(enrollmentCounts.map((e) => [e._id.toString(), e.count]));

  const cycles = docs.map((d) => ({
    id: (d._id as ObjectId).toString(),
    title: d.title,
    targetGrade: d.targetGrade,
    totalWeeks: d.totalWeeks,
    priceWon: d.priceWon,
    description: d.description,
    bulletPoints: d.bulletPoints ?? [],
    startAt: d.startAt,
    endAt: d.endAt,
    isActive: d.isActive,
    createdAt: d.createdAt,
    enrollmentCount: countMap[(d._id as ObjectId).toString()] ?? 0,
  }));

  return NextResponse.json({ cycles });
}

export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON 본문이 필요합니다.' }, { status: 400 });
  }

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const targetGrade = typeof body.targetGrade === 'string' ? body.targetGrade.trim() : '';
  const totalWeeks = typeof body.totalWeeks === 'number' ? body.totalWeeks : 6;
  const priceWon = typeof body.priceWon === 'number' ? body.priceWon : 0;
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const bulletPoints = Array.isArray(body.bulletPoints)
    ? (body.bulletPoints as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];
  const isActive = body.isActive === true;
  const startAt = typeof body.startAt === 'string' ? new Date(body.startAt) : undefined;
  const endAt = typeof body.endAt === 'string' ? new Date(body.endAt) : undefined;

  if (!title) return NextResponse.json({ error: '사이클 제목이 필요합니다.' }, { status: 400 });

  const now = new Date();
  const doc: Omit<ExamCycleDoc, '_id'> = {
    title,
    targetGrade,
    totalWeeks,
    priceWon,
    description,
    bulletPoints,
    startAt,
    endAt,
    isActive,
    createdAt: now,
    updatedAt: now,
  };

  const db = await getDb('gomijoshua');
  const result = await db.collection(CYCLES_COLLECTION).insertOne(doc);
  return NextResponse.json({ ok: true, id: result.insertedId.toString() });
}
