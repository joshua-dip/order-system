import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVipMenu } from '@/lib/vip-menu-guard';
import { getDb } from '@/lib/mongodb';
import {
  VIP_API_KEY_USAGE_COLLECTION,
  ensureApiKeyIndexes,
  type VipApiKeyUsageDoc,
} from '@/lib/vip-api-keys-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function view(u: VipApiKeyUsageDoc) {
  return {
    id: String(u._id),
    keyId: String(u.keyId),
    keyLabel: u.keyLabel,
    at: u.at,
    endpoint: u.endpoint,
    folder: u.folder ?? '',
    type: u.type ?? '',
    limit: u.limit ?? null,
    offset: u.offset ?? null,
    count: u.count,
    status: u.status,
    ip: u.ip ?? '',
    userAgent: u.userAgent ?? '',
    referer: u.referer ?? '',
    origin: u.origin ?? '',
    acceptLanguage: u.acceptLanguage ?? '',
    country: u.country ?? '',
    city: u.city ?? '',
    responseMs: typeof u.responseMs === 'number' ? u.responseMs : null,
    bytes: typeof u.bytes === 'number' ? u.bytes : null,
  };
}

/** GET ?keyId= &limit= — 내 API 키 사용(호출) 내역 + 요약. */
export async function GET(request: NextRequest) {
  const auth = await requireVipMenu(request, 'qbank-api');
  if (auth instanceof NextResponse) return auth;
  const db = await getDb('gomijoshua');
  await ensureApiKeyIndexes(db);
  const userId = new ObjectId(auth.userId);

  const sp = request.nextUrl.searchParams;
  const keyId = sp.get('keyId');
  const limit = Math.min(500, Math.max(1, Number(sp.get('limit')) || 100));

  const filter: Record<string, unknown> = { userId };
  if (keyId && ObjectId.isValid(keyId)) filter.keyId = new ObjectId(keyId);

  const col = db.collection<VipApiKeyUsageDoc>(VIP_API_KEY_USAGE_COLLECTION);
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [logs, total, last7d, last24h, perKey] = await Promise.all([
    col.find(filter).sort({ at: -1 }).limit(limit).toArray(),
    col.countDocuments(filter),
    col.countDocuments({ ...filter, at: { $gte: since7d } }),
    col.countDocuments({ ...filter, at: { $gte: since24h } }),
    col.aggregate([
      { $match: filter },
      { $group: { _id: { keyId: '$keyId', keyLabel: '$keyLabel' }, calls: { $sum: 1 }, items: { $sum: '$count' }, lastAt: { $max: '$at' } } },
      { $sort: { calls: -1 } },
    ]).toArray(),
  ]);

  return NextResponse.json({
    ok: true,
    logs: logs.map(view),
    summary: {
      total,
      last7d,
      last24h,
      returned: logs.length,
      perKey: perKey.map((p) => ({
        keyId: String((p._id as { keyId: ObjectId }).keyId),
        keyLabel: String((p._id as { keyLabel: string }).keyLabel ?? ''),
        calls: p.calls as number,
        items: p.items as number,
        lastAt: p.lastAt as Date,
      })),
    },
  });
}
