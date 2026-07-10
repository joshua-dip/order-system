import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVipMenu } from '@/lib/vip-menu-guard';
import { getDb } from '@/lib/mongodb';
import { GRAMMAR_PROBLEMS_COLLECTION, formatGrammarSerial } from '@/lib/vip-grammar-problem-bank';
import { deriveProblemCategory, isProblemCategory } from '@/lib/vip-problem-category';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET — 문법 문제은행 조회 (소유자 스코프)
 *  · ?topicKey=... [&source=...] [&category=객관식|주관식|선택형] → 해당 진도의 문제 목록
 *  · 파라미터 없음 [&source=...] [&category=...] → topicKey 별 문제 수 맵 + 출처 목록 + 카테고리 집계
 * category 는 콤마로 여러 개 지정 가능(예: 객관식,선택형).
 */
export async function GET(request: NextRequest) {
  const auth = await requireVipMenu(request, 'grammar-problems');
  if (auth instanceof NextResponse) return auth;
  const db = await getDb('gomijoshua');
  const col = db.collection(GRAMMAR_PROBLEMS_COLLECTION);
  const userId = new ObjectId(auth.userId);
  const topicKey = request.nextUrl.searchParams.get('topicKey');
  const source = (request.nextUrl.searchParams.get('source') ?? '').trim();
  const categories = (request.nextUrl.searchParams.get('category') ?? '')
    .split(',').map((s) => s.trim()).filter(isProblemCategory);
  const match: Record<string, unknown> = { userId };
  if (source) match.source = source;
  if (categories.length) match.category = { $in: categories };

  if (!topicKey) {
    const [rows, sources, catRows] = await Promise.all([
      col.aggregate([{ $match: match }, { $group: { _id: '$topicKey', n: { $sum: 1 } } }]).toArray(),
      col.distinct('source', { userId }) as Promise<unknown[]>,
      col.aggregate([{ $match: { userId, ...(source ? { source } : {}) } }, { $group: { _id: '$category', n: { $sum: 1 } } }]).toArray(),
    ]);
    const counts: Record<string, number> = {};
    for (const r of rows) counts[String(r._id)] = r.n as number;
    const categoryCounts: Record<string, number> = {};
    for (const r of catRows) if (r._id) categoryCounts[String(r._id)] = r.n as number;
    return NextResponse.json({
      ok: true,
      counts,
      categoryCounts,
      sources: sources.filter((s): s is string => typeof s === 'string' && !!s).sort((a, b) => a.localeCompare(b, 'ko')),
    });
  }

  const docs = await col
    .find({ ...match, topicKey })
    .sort({ unit: 1, section: 1, no: 1, serialNo: 1 })
    .limit(500)
    .toArray();
  return NextResponse.json({
    ok: true,
    problems: docs.map((d) => ({
      id: String(d._id),
      serial: formatGrammarSerial(d.serialNo),
      section: d.section ?? '',
      no: d.no ?? 0,
      type: d.type ?? '',
      category: isProblemCategory(d.category) ? d.category : deriveProblemCategory(d as Record<string, unknown>),
      instruction: d.instruction ?? '',
      choices: Array.isArray(d.choices) ? d.choices : undefined,
      options: Array.isArray(d.options) ? d.options : undefined,
      question: d.question ?? '',
      answer: d.answer ?? '',
      explanation: d.explanation ?? '',
      source: d.source ?? '',
      subjective: d.subjective && typeof d.subjective === 'object'
        ? {
            type: String((d.subjective as Record<string, unknown>).type ?? ''),
            instruction: String((d.subjective as Record<string, unknown>).instruction ?? ''),
            answer: String((d.subjective as Record<string, unknown>).answer ?? ''),
            choices: Array.isArray((d.subjective as Record<string, unknown>).choices)
              ? ((d.subjective as Record<string, unknown>).choices as string[])
              : undefined,
          }
        : undefined,
    })),
  });
}
