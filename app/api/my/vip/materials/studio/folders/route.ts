import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVipMenu } from '@/lib/vip-menu-guard';
import { getDb } from '@/lib/mongodb';
import { STUDIO_MATERIALS_COLLECTION } from '@/lib/vip-material-studio';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 사용자별 폴더 레지스트리 — 빈 폴더도 유지하기 위해 문서에 저장된 folder 값과 합집합으로 노출 */
const FOLDERS_COLLECTION = 'vip_material_studio_folders';
const RESERVED = new Set(['전체', '미분류']);

function cleanName(v: unknown): string {
  return (typeof v === 'string' ? v : '').trim().slice(0, 40);
}

/** GET — 폴더 이름 목록 (레지스트리 ∪ 문서에 실제 쓰인 폴더) */
export async function GET(request: NextRequest) {
  const auth = await requireVipMenu(request, 'materials');
  if (auth instanceof NextResponse) return auth;
  const db = await getDb('gomijoshua');
  const userId = new ObjectId(auth.userId);
  const reg = await db.collection(FOLDERS_COLLECTION).findOne({ userId });
  const used = (await db.collection(STUDIO_MATERIALS_COLLECTION).distinct('folder', { userId })) as unknown[];
  const names = new Set<string>();
  for (const n of Array.isArray(reg?.names) ? (reg.names as unknown[]) : []) { const c = cleanName(n); if (c) names.add(c); }
  for (const n of used) { const c = cleanName(n); if (c) names.add(c); }
  return NextResponse.json({ ok: true, folders: [...names].sort((a, b) => a.localeCompare(b, 'ko')) });
}

/** POST { name } — 새 폴더 등록 */
export async function POST(request: NextRequest) {
  const auth = await requireVipMenu(request, 'materials');
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const name = cleanName(body.name);
  if (!name) return NextResponse.json({ error: '폴더 이름을 입력해주세요.' }, { status: 400 });
  if (RESERVED.has(name)) return NextResponse.json({ error: '사용할 수 없는 이름입니다.' }, { status: 400 });
  const db = await getDb('gomijoshua');
  await db.collection(FOLDERS_COLLECTION).updateOne(
    { userId: new ObjectId(auth.userId) },
    { $addToSet: { names: name }, $set: { updatedAt: new Date() } },
    { upsert: true },
  );
  return NextResponse.json({ ok: true, name });
}

/** DELETE { name } — 빈 폴더만 삭제 (교재가 있으면 409) */
export async function DELETE(request: NextRequest) {
  const auth = await requireVipMenu(request, 'materials');
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const name = cleanName(body.name);
  if (!name) return NextResponse.json({ error: '폴더 이름이 없습니다.' }, { status: 400 });
  const db = await getDb('gomijoshua');
  const userId = new ObjectId(auth.userId);
  const inUse = await db.collection(STUDIO_MATERIALS_COLLECTION).countDocuments({ userId, folder: name });
  if (inUse > 0) return NextResponse.json({ error: `폴더에 교재 ${inUse}권이 있어요. 먼저 옮기거나 삭제해주세요.` }, { status: 409 });
  await db.collection(FOLDERS_COLLECTION).updateOne({ userId }, { $pull: { names: name } as never, $set: { updatedAt: new Date() } });
  return NextResponse.json({ ok: true });
}
