import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { normalizeVariantSolbookValue, DEFAULT_VARIANT_SOLBOOK_EXTRA_FEE_WON } from '@/lib/variant-solbook-settings';

const SETTINGS_ID = 'variantSolbook' as const;
const SOLBOOK_PUBLISHERS = ['YBM', '쎄듀', 'NE능률'] as const;

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0, must-revalidate',
};

export async function GET(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload || payload.role !== 'admin') {
    return NextResponse.json({ error: '관리자 권한이 필요합니다.' }, { status: 403 });
  }
  try {
    const db = await getDb('gomijoshua');
    const [doc, textbookKeys] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db.collection('settings').findOne({ _id: SETTINGS_ID } as any),
      db
        .collection('passages')
        .distinct('textbook', { publisher: { $in: SOLBOOK_PUBLISHERS as unknown as string[] } }),
    ]);
    const normalized = normalizeVariantSolbookValue(doc?.value);
    const sortedKeys = (textbookKeys as string[]).sort((a, b) => a.localeCompare(b, 'ko'));
    return NextResponse.json(
      {
        textbookKeys: sortedKeys,
        purchaseUrl: normalized.purchaseUrl,
        extraFeeWon: normalized.extraFeeWon,
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (err) {
    console.error('admin variant-solbook GET:', err);
    return NextResponse.json({ error: '조회에 실패했습니다.' }, { status: 500, headers: NO_STORE_HEADERS });
  }
}

export async function PUT(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload || payload.role !== 'admin') {
    return NextResponse.json({ error: '관리자 권한이 필요합니다.' }, { status: 403 });
  }
  try {
    const body = await request.json();
    const textbookKeys = Array.isArray(body.textbookKeys)
      ? body.textbookKeys.filter((k: unknown): k is string => typeof k === 'string')
      : [];
    const purchaseUrl = typeof body.purchaseUrl === 'string' ? body.purchaseUrl.trim() : '';
    let extraFeeWon = DEFAULT_VARIANT_SOLBOOK_EXTRA_FEE_WON;
    if (body.extraFeeWon !== undefined) {
      const n =
        typeof body.extraFeeWon === 'number'
          ? body.extraFeeWon
          : typeof body.extraFeeWon === 'string'
            ? parseInt(body.extraFeeWon, 10)
            : NaN;
      if (Number.isFinite(n) && n >= 0) extraFeeWon = Math.round(n);
    }
    const value = { textbookKeys, purchaseUrl, extraFeeWon };
    const db = await getDb('gomijoshua');
    await db.collection('settings').updateOne(
      { _id: SETTINGS_ID } as any,
      { $set: { value, updatedAt: new Date() } },
      { upsert: true }
    );
    return NextResponse.json({ ok: true, ...value }, { headers: NO_STORE_HEADERS });
  } catch (err) {
    console.error('admin variant-solbook PUT:', err);
    return NextResponse.json({ error: '저장에 실패했습니다.' }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
