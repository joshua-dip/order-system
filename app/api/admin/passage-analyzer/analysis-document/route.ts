import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/lib/mongodb';

const COL = 'passage_analyses';

/** Mongo 문서를 JSON 직렬화 가능한 형태로 (ObjectId·Date 등) */
function toJsonSafe(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (value instanceof ObjectId) return value.toHexString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toJsonSafe);
  const o = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o)) {
    out[k] = toJsonSafe(o[k]);
  }
  return out;
}

/**
 * passage_analyses 단일 문서를 JSON으로 (관리자 · 지문분석기 디버그용)
 * GET ?fileName=passage%3A<24hex>
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const fileName = request.nextUrl.searchParams.get('fileName')?.trim();
  if (!fileName) {
    return NextResponse.json({ error: 'fileName이 필요합니다.' }, { status: 400 });
  }

  try {
    const db = await getDb('gomijoshua');
    const doc = await db.collection(COL).findOne({ fileName });
    if (!doc) {
      return NextResponse.json(
        {
          success: false,
          error: '해당 fileName의 문서가 없습니다. 작업대에서 한 번 저장하면 생성됩니다.',
          database: 'gomijoshua',
          collection: COL,
          fileName,
        },
        { status: 404 }
      );
    }

    const document = toJsonSafe(doc) as Record<string, unknown>;
    return NextResponse.json({
      success: true,
      database: 'gomijoshua',
      collection: COL,
      fileName,
      document,
    });
  } catch (e) {
    console.error('analysis-document GET:', e);
    return NextResponse.json({ error: 'MongoDB 조회 실패' }, { status: 500 });
  }
}
