import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/lib/mongodb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COL = 'analysis_sheet_presets';

/** 분석지 양식(SheetOptions 조합) 저장 — 관리자 계정별. 리체움 sheet-presets 와 같은 발상. */
export async function GET(request: NextRequest) {
  const { error, payload } = await requireAdmin(request);
  if (error) return error;
  const db = await getDb('gomijoshua');
  const docs = await db.collection(COL)
    .find({ userId: payload!.sub })
    .sort({ updatedAt: -1 })
    .limit(50)
    .toArray();
  return NextResponse.json({
    success: true,
    presets: docs.map((d) => ({ id: String(d._id), name: d.name, options: d.options, updatedAt: d.updatedAt })),
  });
}

export async function POST(request: NextRequest) {
  const { error, payload } = await requireAdmin(request);
  if (error) return error;
  let body: { name?: unknown; options?: unknown };
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, message: '요청 형식 오류' }, { status: 400 });
  }
  const name = String(body.name ?? '').trim().slice(0, 40);
  if (!name || !body.options || typeof body.options !== 'object') {
    return NextResponse.json({ success: false, message: '이름과 양식이 필요합니다.' }, { status: 400 });
  }
  const db = await getDb('gomijoshua');
  /* 같은 이름이면 덮어쓴다 — "판매본" 양식을 다듬어 다시 저장하는 흐름. */
  await db.collection(COL).updateOne(
    { userId: payload!.sub, name },
    { $set: { userId: payload!.sub, name, options: body.options, updatedAt: new Date() } },
    { upsert: true },
  );
  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const { error, payload } = await requireAdmin(request);
  if (error) return error;
  const id = request.nextUrl.searchParams.get('id') ?? '';
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ success: false, message: 'id 가 필요합니다.' }, { status: 400 });
  }
  const db = await getDb('gomijoshua');
  await db.collection(COL).deleteOne({ _id: new ObjectId(id), userId: payload!.sub });
  return NextResponse.json({ success: true });
}
