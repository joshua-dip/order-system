import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';

const VALID_TEXTBOOK_TYPES = ['교과서', '부교재'] as const;
type TextbookType = (typeof VALID_TEXTBOOK_TYPES)[number];

const SETTINGS_ID = 'textbookTypeMeta' as const;

/**
 * 쏠북 교재별 구분(교과서 / 부교재) 조회/변경.
 * passages가 없는 교재도 설정할 수 있도록 settings 컬렉션에 맵으로 저장.
 * settings._id = 'textbookTypeMeta', value = { [textbookKey]: '교과서' | '부교재' }
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const db = await getDb('gomijoshua');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = await db.collection('settings').findOne({ _id: SETTINGS_ID } as any);
    const raw = (doc?.value ?? {}) as Record<string, unknown>;
    const textbookTypes: Record<string, TextbookType | null> = {};
    for (const [key, val] of Object.entries(raw)) {
      textbookTypes[key] = VALID_TEXTBOOK_TYPES.includes(val as TextbookType)
        ? (val as TextbookType)
        : null;
    }
    return NextResponse.json({ textbookTypes });
  } catch (e) {
    console.error('textbook-type-by-textbook GET:', e);
    return NextResponse.json({ error: '조회에 실패했습니다.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const body = await request.json();
    const textbookKey = typeof body.textbookKey === 'string' ? body.textbookKey.trim() : '';
    if (!textbookKey) {
      return NextResponse.json({ error: '교재명이 필요합니다.' }, { status: 400 });
    }
    const typeRaw = typeof body.textbookType === 'string' ? body.textbookType.trim() : '';
    const textbookType: TextbookType | null = VALID_TEXTBOOK_TYPES.includes(typeRaw as TextbookType)
      ? (typeRaw as TextbookType)
      : null;

    const db = await getDb('gomijoshua');
    const col = db.collection('settings');

    // dot notation($set: {"value.key": ...}) 사용 시 키 이름의 '.'이 중첩 경로로
    // 해석되는 MongoDB 버그를 피하기 위해 문서 전체를 읽어 JS에서 수정 후 교체한다.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const existing = await col.findOne({ _id: SETTINGS_ID } as any);
    const valueMap = (existing?.value ?? {}) as Record<string, string>;

    if (textbookType) {
      valueMap[textbookKey] = textbookType;
    } else {
      delete valueMap[textbookKey];
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await col.replaceOne(
      { _id: SETTINGS_ID } as any,
      { _id: SETTINGS_ID, value: valueMap, updated_at: new Date() },
      { upsert: true }
    );

    return NextResponse.json({ ok: true, textbookKey, textbookType });
  } catch (e) {
    console.error('textbook-type-by-textbook POST:', e);
    return NextResponse.json({ error: '업데이트에 실패했습니다.' }, { status: 500 });
  }
}
