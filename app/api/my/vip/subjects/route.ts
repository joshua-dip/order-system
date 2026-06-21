import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVip } from '@/lib/vip-auth';
import { getVipDb, ensureVipIndexes, col, type VipSubject, DEFAULT_VIP_SUBJECTS } from '@/lib/vip-db';

/** 사용자별 과목 마스터 — 학생 등록 수강과목 드롭다운 소스. */
export async function GET(request: NextRequest) {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;

  const db = await getVipDb();
  await ensureVipIndexes(db);
  const uid = new ObjectId(auth.userId);

  let items = await col<VipSubject>(db, 'subjects').find({ userId: uid }).sort({ order: 1, name: 1 }).toArray();
  if (items.length === 0) {
    // 최초 진입 — 기본 과목 시드. 동시 요청의 unique 충돌은 무시.
    try {
      await col<VipSubject>(db, 'subjects').insertMany(
        DEFAULT_VIP_SUBJECTS.map((name, i) => ({ userId: uid, name, order: i, createdAt: new Date() })) as never[],
        { ordered: false },
      );
    } catch {
      /* 동시 시드 중복 무시 */
    }
    items = await col<VipSubject>(db, 'subjects').find({ userId: uid }).sort({ order: 1, name: 1 }).toArray();
  }

  return NextResponse.json({
    ok: true,
    subjects: items.map((s) => ({ id: s._id!.toString(), name: s.name, order: s.order })),
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json();
  const name = (body.name ?? '').trim();
  if (!name) return NextResponse.json({ error: '과목명을 입력해주세요.' }, { status: 400 });

  const db = await getVipDb();
  await ensureVipIndexes(db);
  const uid = new ObjectId(auth.userId);

  const existing = await col<VipSubject>(db, 'subjects').findOne({ userId: uid, name });
  if (existing) return NextResponse.json({ ok: true, id: existing._id!.toString(), name, order: existing.order, existed: true });

  const last = await col<VipSubject>(db, 'subjects').find({ userId: uid }).sort({ order: -1 }).limit(1).toArray();
  const order = (last[0]?.order ?? -1) + 1;
  const doc: VipSubject = { userId: uid, name, order, createdAt: new Date() };
  const result = await col<VipSubject>(db, 'subjects').insertOne(doc as never);
  return NextResponse.json({ ok: true, id: result.insertedId.toString(), name, order }, { status: 201 });
}
