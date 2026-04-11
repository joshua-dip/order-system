import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { variationPercentAgainstOriginal } from '@/lib/paragraph-variation';
import { getPassageTextForVariantCompare, passageIdToValidHex } from '@/lib/passage-variant-text';

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const sp = request.nextUrl.searchParams;
  const textbook = sp.get('textbook')?.trim() || '';
  const type = sp.get('type')?.trim() || '';
  const difficulty = sp.get('difficulty')?.trim() || '';
  const status = sp.get('status')?.trim() || '';
  const pricFilter = sp.get('pric')?.trim() || '';
  const passageId = sp.get('passage_id')?.trim() || '';
  const flaggedFilter = sp.get('flagged')?.trim() || '';

  const filter: Record<string, unknown> = {};
  if (textbook) filter.textbook = textbook;
  if (type) filter.type = type;
  if (difficulty) filter.difficulty = difficulty;
  if (status) filter.status = status;
  if (passageId && ObjectId.isValid(passageId)) {
    filter.passage_id = passageId;
  }
  if (pricFilter === 'assigned') filter.pric = { $exists: true, $ne: null };
  else if (pricFilter === 'unassigned') {
    filter.$or = [{ pric: { $exists: false } }, { pric: null }];
  }
  if (flaggedFilter === 'yes') filter.flagged = true;
  else if (flaggedFilter === 'no') {
    filter.flagged = { $ne: true };
  }

  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');

  const docs = await col
    .find(filter)
    .sort({ textbook: 1, source: 1, type: 1, 'question_data.순서': 1 })
    .project({
      textbook: 1,
      source: 1,
      type: 1,
      difficulty: 1,
      status: 1,
      pric: 1,
      passage_id: 1,
      question_data: 1,
      reviewComment: 1,
      teacherExplanation: 1,
      flagged: 1,
      flaggedAt: 1,
    })
    .limit(500)
    .toArray();

  /* ── variation_pct 계산 ── */
  const idHexSet = new Set<string>();
  for (const d of docs) {
    const h = passageIdToValidHex(d.passage_id);
    if (h) idHexSet.add(h);
  }
  const passageMap = new Map<string, string>();
  if (idHexSet.size > 0) {
    const passageOids = Array.from(idHexSet).map((h) => new ObjectId(h));
    const passages = await db
      .collection('passages')
      .find({ _id: { $in: passageOids } })
      .project({ _id: 1, 'content.original': 1, 'content.mixed': 1, 'content.translation': 1 })
      .toArray();
    for (const p of passages) {
      passageMap.set(
        String(p._id),
        getPassageTextForVariantCompare((p as { content?: Record<string, unknown> }).content),
      );
    }
  }

  const items = docs.map((d: Record<string, unknown>) => {
    const pid = passageIdToValidHex(d.passage_id);
    const orig = pid ? (passageMap.get(pid) ?? '') : '';
    const qd = d.question_data as Record<string, unknown> | undefined;
    const para = typeof qd?.Paragraph === 'string' ? (qd.Paragraph as string) : '';
    const typeStr = String(d.type ?? '').trim();
    const variation_pct = pid && orig
      ? variationPercentAgainstOriginal(typeStr, orig, para, qd)
      : null;
    return { ...d, variation_pct };
  });

  const stats = {
    total: await col.countDocuments(filter),
    pricAssigned: await col.countDocuments({ ...filter, pric: { $exists: true, $ne: null } }),
  };

  return NextResponse.json({ items, stats });
}
