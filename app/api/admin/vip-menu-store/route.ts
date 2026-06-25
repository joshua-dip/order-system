import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { VIP_MENU_CATALOG, VIP_MENU_IDS, VIP_MENU_STORE_SETTINGS_ID, type VipMenuStoreConfig } from '@/lib/vip-menu-catalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET — 메뉴별 유료/가격 설정 (+ 카탈로그) */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;
  const db = await getDb('gomijoshua');
  const doc = await db.collection('settings').findOne({ _id: VIP_MENU_STORE_SETTINGS_ID } as unknown as Record<string, unknown>);
  const config = (doc?.value && typeof doc.value === 'object') ? (doc.value as VipMenuStoreConfig) : {};
  return NextResponse.json({
    ok: true,
    menus: VIP_MENU_CATALOG.map((m) => ({
      id: m.id,
      label: m.label,
      paid: !!config[m.id]?.paid,
      price: Number.isFinite(config[m.id]?.price) ? Number(config[m.id]?.price) : 0,
      published: !!config[m.id]?.published,
    })),
  });
}

/** PUT — 설정 저장 ({ menus: { [id]: { paid, price } } }) */
export async function PUT(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;
  let body: { menus?: unknown };
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }); }
  const input = (body.menus && typeof body.menus === 'object') ? (body.menus as Record<string, { paid?: unknown; price?: unknown; published?: unknown }>) : {};

  const config: VipMenuStoreConfig = {};
  for (const m of VIP_MENU_CATALOG) {
    const row = input[m.id];
    if (!row) continue;
    const paid = !!row.paid;
    const price = Math.max(0, Math.floor(Number(row.price) || 0));
    // 유료(가격>0)인 메뉴만 저장. published 도 함께 보존(공개 여부).
    if (paid && price > 0) config[m.id] = { paid: true, price, published: !!row.published };
  }
  // 카탈로그 외 키 무시 (VIP_MENU_IDS 로 한정)
  for (const k of Object.keys(config)) if (!VIP_MENU_IDS.has(k)) delete config[k];

  const db = await getDb('gomijoshua');
  await db.collection('settings').updateOne(
    { _id: VIP_MENU_STORE_SETTINGS_ID } as unknown as Record<string, unknown>,
    { $set: { value: config, updatedAt: new Date() } },
    { upsert: true },
  );
  return NextResponse.json({ ok: true });
}
