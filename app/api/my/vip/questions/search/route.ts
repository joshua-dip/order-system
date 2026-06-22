import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVipMenu } from '@/lib/vip-menu-guard';
import { getDb } from '@/lib/mongodb';
import { buildVariantQFilter } from '@/lib/admin-generated-questions-q-filter';
import { QUESTION_BANK_COLLECTION, previewText } from '@/lib/vip-question-bank-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;

/** 변형문제(generated_questions) 불러오기 검색 — VIP 선생님이 내 문제은행에 담을 후보 조회. */
export async function GET(request: NextRequest) {
  const auth = await requireVipMenu(request, 'questions');
  if (auth instanceof NextResponse) return auth;

  const sp = request.nextUrl.searchParams;
  const type = (sp.get('type') || '').trim();
  const textbook = (sp.get('textbook') || '').trim();
  const difficulty = (sp.get('difficulty') || '').trim();
  const q = (sp.get('q') || '').trim();
  const page = Math.max(1, Number(sp.get('page')) || 1);

  const filter: Record<string, unknown> = { status: '완료' };
  if (type) filter.type = type;
  if (textbook) filter.textbook = textbook;
  if (difficulty) filter.difficulty = difficulty;

  // q: "V-000123" / "123" → 고유번호 정확검색, 아니면 출처/교재 라벨 검색
  if (q) {
    const serialMatch = q.match(/^v?-?\s*0*(\d{1,7})$/i);
    if (serialMatch) {
      filter.serialNo = Number(serialMatch[1]);
    } else {
      const qf = buildVariantQFilter(q);
      if (qf) Object.assign(filter, qf);
      else filter.source = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    }
  }

  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');

  const total = await col.countDocuments(filter);
  const rawDocs = await col
    .find(filter)
    .project({ serialNo: 1, type: 1, textbook: 1, source: 1, difficulty: 1, 'question_data.Question': 1, 'question_data.Paragraph': 1, 'question_data.Source': 1 })
    .sort({ serialNo: -1 })
    .skip((page - 1) * PAGE_SIZE)
    .limit(PAGE_SIZE)
    .toArray();

  // 이미 내 문제은행에 담긴 것 표시
  const ids = rawDocs.map((d) => d._id as ObjectId);
  const savedSet = new Set<string>();
  if (ids.length > 0) {
    const saved = await db
      .collection(QUESTION_BANK_COLLECTION)
      .find({ userId: new ObjectId(auth.userId), questionId: { $in: ids } })
      .project({ questionId: 1 })
      .toArray();
    for (const s of saved) savedSet.add(String(s.questionId));
  }

  const items = rawDocs.map((d) => {
    const qd = (d.question_data ?? {}) as { Question?: string; Paragraph?: string; Source?: string };
    return {
      questionId: String(d._id),
      serialNo: typeof d.serialNo === 'number' ? d.serialNo : null,
      type: String(d.type ?? ''),
      textbook: String(d.textbook ?? ''),
      source: String(d.source ?? qd.Source ?? ''),
      difficulty: String(d.difficulty ?? ''),
      question: previewText(qd.Question, 70),
      preview: previewText(qd.Paragraph, 110),
      saved: savedSet.has(String(d._id)),
    };
  });

  return NextResponse.json({ ok: true, items, total, page, pageSize: PAGE_SIZE, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)) });
}
