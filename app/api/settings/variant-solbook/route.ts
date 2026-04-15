import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { normalizeVariantSolbookValue } from '@/lib/variant-solbook-settings';

const SETTINGS_ID = 'variantSolbook' as const;
const TEXTBOOK_TYPE_META_ID = 'textbookTypeMeta' as const;
const SOLBOOK_PUBLISHERS = ['YBM', '쎄듀', 'NE능률'] as const;

/** 관리자 저장 직후 주문·교재 화면에 즉시 반영되도록 캐시 금지 */
export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0, must-revalidate',
};

/**
 * 변형문제 쏠북 교재·구매 안내 (비인증). /textbook · 주문 화면에서 사용.
 *
 * 쏠북 여부: passages.publisher 또는 settings.textbookTypeMeta에 등록된 교재.
 * 교과서/부교재 구분: settings.textbookTypeMeta._id='textbookTypeMeta'.value 맵.
 *   → 지문이 없는 교재도 설정 가능.
 * purchaseUrl / extraFeeWon: settings.variantSolbook.
 */
export async function GET() {
  try {
    const db = await getDb('gomijoshua');

    const [doc, passageRows, typeMetaDoc] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db.collection('settings').findOne({ _id: SETTINGS_ID } as any),
      // passages에 publisher가 설정된 교재 목록 (지문 존재하는 경우)
      db
        .collection('passages')
        .aggregate([
          { $match: { publisher: { $in: SOLBOOK_PUBLISHERS as unknown as string[] } } },
          { $group: { _id: '$textbook' } },
          { $project: { textbook: '$_id', _id: 0 } },
        ])
        .toArray(),
      // textbookType 메타: settings 컬렉션에 저장된 맵
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db.collection('settings').findOne({ _id: TEXTBOOK_TYPE_META_ID } as any),
    ]);

    const normalized = normalizeVariantSolbookValue(doc?.value);
    const typeMap = (typeMetaDoc?.value ?? {}) as Record<string, string>;

    // 쏠북 교재 = passages publisher + textbookTypeMeta + 관리자가 variantSolbook에 넣은 textbookKeys (합집합)
    const solbookKeySet = new Set<string>();
    for (const row of passageRows) {
      const key = String(row.textbook || '');
      if (key) solbookKeySet.add(key);
    }
    for (const key of Object.keys(typeMap)) {
      if (key) solbookKeySet.add(key);
    }
    for (const key of normalized.textbookKeys) {
      if (key) solbookKeySet.add(key);
    }

    const textbookKeys = [...solbookKeySet];
    const 교과서Keys: string[] = [];
    const 부교재Keys: string[] = [];

    for (const key of textbookKeys) {
      const t = typeMap[key];
      if (t === '교과서') 교과서Keys.push(key);
      else if (t === '부교재') 부교재Keys.push(key);
    }

    const sort = (a: string, b: string) => a.localeCompare(b, 'ko');
    textbookKeys.sort(sort);
    교과서Keys.sort(sort);
    부교재Keys.sort(sort);

    return NextResponse.json(
      {
        textbookKeys,
        교과서Keys,
        부교재Keys,
        purchaseUrl: normalized.purchaseUrl,
        extraFeeWon: normalized.extraFeeWon,
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (err) {
    console.error('variant-solbook settings GET:', err);
    return NextResponse.json(
      { textbookKeys: [], 교과서Keys: [], 부교재Keys: [], purchaseUrl: '', extraFeeWon: 3000 },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  }
}
