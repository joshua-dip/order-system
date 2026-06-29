import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVip } from '@/lib/vip-auth';
import { getDb } from '@/lib/mongodb';
import {
  VIP_STUDIO_COLLECTION,
  ensureStudioIndexes,
  normalizeStudioMarks,
  normalizeStudioProblems,
  studioView,
  type VipStudioDoc,
} from '@/lib/vip-studio-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 기존 변형 DB(generated_questions) 의 이 지문 현황. */
async function bankStatus(db: Awaited<ReturnType<typeof getDb>>, passageId: string) {
  if (!ObjectId.isValid(passageId)) return { total: 0, 완료: 0, 대기: 0, 검수불일치: 0 };
  const rows = await db.collection('generated_questions').aggregate([
    { $match: { passage_id: new ObjectId(passageId) } },
    { $group: { _id: '$status', n: { $sum: 1 } } },
  ]).toArray();
  const out = { total: 0, 완료: 0, 대기: 0, 검수불일치: 0 } as Record<string, number>;
  for (const r of rows) { const s = String(r._id ?? ''); out.total += r.n; if (s in out) out[s] += r.n; }
  return out;
}

/** GET ?passageId — 내 스튜디오 문서 + 기존 변형 DB 현황. */
export async function GET(request: NextRequest) {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;
  const passageId = request.nextUrl.searchParams.get('passageId') ?? '';
  if (!passageId) return NextResponse.json({ error: 'passageId 가 필요합니다.' }, { status: 400 });

  const db = await getDb('gomijoshua');
  await ensureStudioIndexes(db);
  const doc = await db.collection<VipStudioDoc>(VIP_STUDIO_COLLECTION).findOne({ userId: new ObjectId(auth.userId), passageId });
  const bank = await bankStatus(db, passageId);
  return NextResponse.json({ ok: true, studio: studioView(doc), bank });
}

/** PUT ?passageId — 내 스튜디오(marks·problems) 저장(upsert). */
export async function PUT(request: NextRequest) {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;
  const passageId = request.nextUrl.searchParams.get('passageId') ?? '';
  if (!passageId) return NextResponse.json({ error: 'passageId 가 필요합니다.' }, { status: 400 });
  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }); }

  const db = await getDb('gomijoshua');
  await ensureStudioIndexes(db);
  // 사용자 이름(식별용 — 본인이 쓰는 문제이므로 이름으로 관리)
  const userDoc = await db.collection('users').findOne({ _id: new ObjectId(auth.userId) }, { projection: { name: 1, loginId: 1 } });
  const userName = String((userDoc as { name?: unknown } | null)?.name ?? '').trim();
  const loginId = String((userDoc as { loginId?: unknown } | null)?.loginId ?? auth.loginId ?? '').trim();
  const now = new Date();
  const set = {
    userName: userName || loginId,
    loginId,
    textbook: String(body.textbook ?? '').slice(0, 200),
    sourceKey: String(body.sourceKey ?? '').slice(0, 200),
    source: String(body.source ?? '').slice(0, 300),
    examType: String(body.examType ?? '').slice(0, 60),
    marks: normalizeStudioMarks(body.marks),
    problems: normalizeStudioProblems(body.problems),
    updatedAt: now,
  };
  await db.collection<VipStudioDoc>(VIP_STUDIO_COLLECTION).updateOne(
    { userId: new ObjectId(auth.userId), passageId },
    { $set: set, $setOnInsert: { userId: new ObjectId(auth.userId), passageId, createdAt: now } },
    { upsert: true },
  );
  const bank = await bankStatus(db, passageId);
  return NextResponse.json({ ok: true, bank });
}
