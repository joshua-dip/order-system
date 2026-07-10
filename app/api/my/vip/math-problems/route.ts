import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVipMenu } from '@/lib/vip-menu-guard';
import { getDb } from '@/lib/mongodb';
import { MATH_PROBLEMS_COLLECTION, formatMathSerial, difficultyRank } from '@/lib/vip-math-problem-bank';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET — 수학 문제은행 조회 (소유자 스코프)
 *  · ?topicKey=... [&source=...] → 해당 진도의 문제 목록 (난도·번호 순)
 *  · 파라미터 없음 [&source=...] → topicKey 별 문제 수 맵 (트리 배지용) + 전체 출처 목록
 */
export async function GET(request: NextRequest) {
  const auth = await requireVipMenu(request, 'math-problems');
  if (auth instanceof NextResponse) return auth;
  const db = await getDb('gomijoshua');
  const col = db.collection(MATH_PROBLEMS_COLLECTION);
  const userId = new ObjectId(auth.userId);
  const topicKey = request.nextUrl.searchParams.get('topicKey');
  const source = (request.nextUrl.searchParams.get('source') ?? '').trim();
  const match: Record<string, unknown> = { userId };
  if (source) match.source = source;

  if (!topicKey) {
    const [rows, sources] = await Promise.all([
      col.aggregate([{ $match: match }, { $group: { _id: '$topicKey', n: { $sum: 1 } } }]).toArray(),
      col.distinct('source', { userId }) as Promise<unknown[]>,
    ]);
    const counts: Record<string, number> = {};
    for (const r of rows) counts[String(r._id)] = r.n as number;
    return NextResponse.json({
      ok: true,
      counts,
      sources: sources.filter((s): s is string => typeof s === 'string' && !!s).sort((a, b) => a.localeCompare(b, 'ko')),
    });
  }

  const docs = await col.find({ ...match, topicKey }).limit(500).toArray();
  docs.sort(
    (a, b) =>
      difficultyRank(a.difficulty) - difficultyRank(b.difficulty) ||
      (a.no ?? 0) - (b.no ?? 0) ||
      (a.serialNo ?? 0) - (b.serialNo ?? 0),
  );
  return NextResponse.json({
    ok: true,
    problems: docs.map((d) => ({
      id: String(d._id),
      serial: formatMathSerial(d.serialNo),
      no: d.no ?? 0,
      difficulty: d.difficulty ?? '기본',
      type: d.type ?? '주관식',
      question: d.question ?? '',
      choices: Array.isArray(d.choices) ? d.choices : undefined,
      answer: d.answer ?? '',
      solution: d.solution ?? '',
      source: d.source ?? '',
    })),
  });
}
