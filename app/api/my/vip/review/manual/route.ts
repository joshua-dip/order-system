import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVipMenu } from '@/lib/vip-menu-guard';
import { getDb } from '@/lib/mongodb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 수동 오답노트 컬렉션 (국어·수학 등 QR 자동채점이 없는 과목용). (userId, subject) 스코프. */
const MANUAL_REVIEW_COLLECTION = 'vip_manual_review_notes';

/** 자동(QR) 오답노트가 있는 영어는 수동 입력 대상이 아님 — 그 외 과목만 허용. */
const ALLOWED_SUBJECTS = new Set(['국어', '수학']);

function s(v: unknown, max = 2000): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/** GET /api/my/vip/review/manual?subject=국어 — 내 수동 오답노트 목록 */
export async function GET(request: NextRequest) {
  const auth = await requireVipMenu(request, 'review');
  if (auth instanceof NextResponse) return auth;

  const subject = s(request.nextUrl.searchParams.get('subject'), 20);
  if (!ALLOWED_SUBJECTS.has(subject)) {
    return NextResponse.json({ error: '지원하지 않는 과목입니다.' }, { status: 400 });
  }

  const db = await getDb('gomijoshua');
  const userId = new ObjectId(auth.userId);
  const docs = await db
    .collection(MANUAL_REVIEW_COLLECTION)
    .find({ userId, subject })
    .sort({ createdAt: -1 })
    .limit(500)
    .toArray();

  const notes = docs.map((d) => ({
    id: (d._id as ObjectId).toString(),
    studentName: d.studentName ?? '',
    source: d.source ?? '',
    questionText: d.questionText ?? '',
    wrongAnswer: d.wrongAnswer ?? '',
    correctAnswer: d.correctAnswer ?? '',
    memo: d.memo ?? '',
    createdAt: d.createdAt instanceof Date ? d.createdAt.toISOString() : (d.createdAt ?? null),
  }));

  return NextResponse.json({ ok: true, notes });
}

/** POST — 수동 오답노트 한 건 추가 */
export async function POST(request: NextRequest) {
  const auth = await requireVipMenu(request, 'review');
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => ({}));
  const subject = s(body.subject, 20);
  if (!ALLOWED_SUBJECTS.has(subject)) {
    return NextResponse.json({ error: '지원하지 않는 과목입니다.' }, { status: 400 });
  }
  const studentName = s(body.studentName, 60);
  if (!studentName) {
    return NextResponse.json({ error: '학생 이름을 입력해 주세요.' }, { status: 400 });
  }
  const questionText = s(body.questionText, 4000);
  const memo = s(body.memo, 4000);
  if (!questionText && !memo) {
    return NextResponse.json({ error: '문제 내용 또는 메모 중 하나는 입력해 주세요.' }, { status: 400 });
  }

  const db = await getDb('gomijoshua');
  const userId = new ObjectId(auth.userId);
  const doc = {
    userId,
    subject,
    studentName,
    source: s(body.source, 200),
    questionText,
    wrongAnswer: s(body.wrongAnswer, 500),
    correctAnswer: s(body.correctAnswer, 500),
    memo,
    createdAt: new Date(),
  };
  const r = await db.collection(MANUAL_REVIEW_COLLECTION).insertOne(doc);
  return NextResponse.json({ ok: true, id: r.insertedId.toString() });
}

/** DELETE — 내 수동 오답노트 한 건 삭제 (body 또는 ?id=) */
export async function DELETE(request: NextRequest) {
  const auth = await requireVipMenu(request, 'review');
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => ({}));
  const id = s(body.id, 40) || s(request.nextUrl.searchParams.get('id'), 40);
  if (!id || !ObjectId.isValid(id)) {
    return NextResponse.json({ error: '유효하지 않은 ID입니다.' }, { status: 400 });
  }

  const db = await getDb('gomijoshua');
  const userId = new ObjectId(auth.userId);
  const r = await db.collection(MANUAL_REVIEW_COLLECTION).deleteOne({ _id: new ObjectId(id), userId });
  if (r.deletedCount === 0) {
    return NextResponse.json({ error: '삭제할 항목을 찾을 수 없습니다.' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
