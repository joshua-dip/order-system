import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVipMenu } from '@/lib/vip-menu-guard';
import { getDb } from '@/lib/mongodb';
import { GRAMMAR_ANSWER_KEY_COLLECTION, lookupAnswer, type GrammarAnswerKeyDoc } from '@/lib/vip-grammar-answer-key';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET — 교재 정답키 (채점 자동화용, 소유자 스코프 · 내부 전용, 공개 API 아님)
 *  · 파라미터 없음 → 보유 교재별 UNIT·정답 수 요약
 *  · ?book= → 그 교재의 UNIT별 정답키 전체
 *  · ?book=&unit=&section=&no= → 단일 정답 (채점 조회)
 */
export async function GET(request: NextRequest) {
  const auth = await requireVipMenu(request, 'grammar-problems');
  if (auth instanceof NextResponse) return auth;
  const db = await getDb('gomijoshua');
  const col = db.collection<GrammarAnswerKeyDoc>(GRAMMAR_ANSWER_KEY_COLLECTION);
  const userId = new ObjectId(auth.userId);
  const sp = request.nextUrl.searchParams;
  const book = (sp.get('book') || '').trim();
  const unit = sp.get('unit');
  const section = (sp.get('section') || '').trim().toUpperCase();
  const no = sp.get('no');

  // 단일 정답 조회 (채점기)
  if (book && unit && section && no) {
    const doc = await col.findOne({ userId, book, unit: Number(unit) });
    const answer = lookupAnswer(doc, section, Number(no));
    return NextResponse.json({ ok: true, book, unit: Number(unit), section, no: Number(no), answer });
  }

  // 교재별 정답키 전체
  if (book) {
    const docs = await col.find({ userId, book }).sort({ unit: 1 }).toArray();
    return NextResponse.json({
      ok: true, book,
      units: docs.map((d) => ({ unit: d.unit, chapter: d.chapter, title: d.title, exercises: d.exercises, answerCount: d.answerCount })),
    });
  }

  // 요약 (보유 교재 목록)
  const rows = await col.aggregate([
    { $match: { userId } },
    { $group: { _id: '$book', units: { $sum: 1 }, answers: { $sum: '$answerCount' } } },
    { $sort: { _id: 1 } },
  ]).toArray();
  return NextResponse.json({ ok: true, books: rows.map((r) => ({ book: String(r._id), units: r.units as number, answers: r.answers as number })) });
}
