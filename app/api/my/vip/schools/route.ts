import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVip } from '@/lib/vip-auth';
import { getVipDb, ensureVipIndexes, col, type VipSchool } from '@/lib/vip-db';

export async function GET(request: NextRequest) {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;

  const db = await getVipDb();
  await ensureVipIndexes(db);
  const uid = new ObjectId(auth.userId);

  const search = request.nextUrl.searchParams.get('search') || '';
  const filter: Record<string, unknown> = { userId: uid };
  if (search) filter.name = { $regex: search, $options: 'i' };

  const schools = await col<VipSchool>(db, 'schools')
    .find(filter)
    .sort({ name: 1 })
    .toArray();

  return NextResponse.json({
    ok: true,
    schools: schools.map((s) => ({
      id: s._id.toString(),
      name: s.name,
      region: s.region ?? '',
      createdAt: s.createdAt?.toISOString() ?? '',
    })),
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json();
  const name = (body.name ?? '').trim();
  if (!name) return NextResponse.json({ error: '학교 이름을 입력해주세요.' }, { status: 400 });

  const db = await getVipDb();
  await ensureVipIndexes(db);
  const uid = new ObjectId(auth.userId);

  const existing = await col<VipSchool>(db, 'schools').findOne({ userId: uid, name });
  if (existing) {
    return NextResponse.json({ ok: true, id: existing._id.toString(), existed: true });
  }

  const doc: VipSchool = {
    userId: uid,
    name,
    region: (body.region ?? '').trim() || undefined,
    createdAt: new Date(),
  };

  const result = await col<VipSchool>(db, 'schools').insertOne(doc as any);
  return NextResponse.json({ ok: true, id: result.insertedId.toString() }, { status: 201 });
}
