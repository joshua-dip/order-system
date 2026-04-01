import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/lib/mongodb';
import { GENERATED_QUESTION_CLAUDE_REVIEWS_COL } from '@/lib/generated-question-review-log';

/** 최근 로그 요약: 대기 건수 등 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const db = await getDb('gomijoshua');
    const gq = db.collection('generated_questions');
    const logs = db.collection(GENERATED_QUESTION_CLAUDE_REVIEWS_COL);

    const [pendingCount, logTotal, lastRun] = await Promise.all([
      gq.countDocuments({ status: '대기' }),
      logs.countDocuments({}),
      logs.findOne({}, { sort: { created_at: -1 }, projection: { created_at: 1 } }),
    ]);

    const recentAgg = await logs
      .aggregate<{ ok: number; bad: number; err: number }>([
        { $match: { created_at: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } },
        {
          $group: {
            _id: null,
            ok: {
              $sum: {
                $cond: [{ $eq: ['$is_correct', true] }, 1, 0],
              },
            },
            bad: {
              $sum: {
                $cond: [{ $eq: ['$is_correct', false] }, 1, 0],
              },
            },
            err: {
              $sum: {
                $cond: [{ $ne: ['$error', null] }, 1, 0],
              },
            },
          },
        },
      ])
      .toArray();
    const r = recentAgg[0];

    return NextResponse.json({
      pending_count: pendingCount,
      log_total: logTotal,
      last_log_at: lastRun?.created_at ?? null,
      last_7d: {
        match: r?.ok ?? 0,
        mismatch: r?.bad ?? 0,
        errors: r?.err ?? 0,
      },
    });
  } catch (e) {
    console.error('review-logs stats:', e);
    return NextResponse.json({ error: '통계 조회 실패' }, { status: 500 });
  }
}
