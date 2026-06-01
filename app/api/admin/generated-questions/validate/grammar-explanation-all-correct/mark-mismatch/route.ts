import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';

const MAX_IDS = 500;

/**
 * 어법 해설 모순(모든 어법이 맞다고 단언) 검증에서 찾아낸 문항들을
 * questionStatus='검수불일치' 로 일괄 마킹.
 * Pro-only 안전 경로 (Anthropic API 호출 없음).
 */
export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const body = (await request.json()) as { ids?: unknown };
    const raw = Array.isArray(body.ids) ? body.ids : [];
    const ids: ObjectId[] = [];
    for (const v of raw) {
      if (typeof v !== 'string') continue;
      try {
        ids.push(new ObjectId(v));
      } catch {
        /* skip invalid */
      }
      if (ids.length >= MAX_IDS) break;
    }
    if (ids.length === 0) {
      return NextResponse.json(
        { error: '대상 ID가 비어 있습니다.' },
        { status: 400 }
      );
    }

    const db = await getDb('gomijoshua');
    const col = db.collection('generated_questions');
    const res = await col.updateMany(
      { _id: { $in: ids } },
      {
        $set: {
          status: '검수불일치',
          updated_at: new Date(),
        },
        $unset: { questionStatus: '' },
      }
    );

    return NextResponse.json({
      ok: true,
      requested: ids.length,
      matched: res.matchedCount,
      modified: res.modifiedCount,
    });
  } catch (e) {
    console.error('validate/grammar-explanation-all-correct/mark-mismatch:', e);
    return NextResponse.json(
      { error: '일괄 마킹 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
