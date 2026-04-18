import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import {
  GUEST_GENERATED_QUESTIONS_COLLECTION,
  ensureGuestGeneratedIndexes,
} from '@/lib/guest-generated-questions-store';
import {
  buildGuestLogsFilter,
  serializeGuestLog,
} from '@/lib/guest-variant-logs-admin';

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  await ensureGuestGeneratedIndexes();

  const sp = request.nextUrl.searchParams;
  const page = Math.max(1, parseInt(sp.get('page') || '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(sp.get('limit') || '25', 10) || 25));
  const skip = (page - 1) * limit;
  const needsShortageOnly = sp.get('needs_shortage') === '1';

  const filter = buildGuestLogsFilter(sp);

  try {
    const db = await getDb('gomijoshua');
    const col = db.collection(GUEST_GENERATED_QUESTIONS_COLLECTION);
    const gqCol = db.collection('generated_questions');

    const [total, items, statsAgg, topTextbooks] = await Promise.all([
      col.countDocuments(filter),
      col
        .find(filter)
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      col
        .aggregate([
          {
            $facet: {
              all: [{ $count: 'n' }],
              matched: [{ $match: { match_status: 'matched' } }, { $count: 'n' }],
              unknown: [{ $match: { match_status: 'unknown' } }, { $count: 'n' }],
              last_7d: [
                {
                  $match: {
                    created_at: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
                  },
                },
                { $count: 'n' },
              ],
              unique_ip: [
                { $match: { ip_hash: { $exists: true, $ne: '' } } },
                { $group: { _id: '$ip_hash' } },
                { $count: 'n' },
              ],
              by_type: [
                { $group: { _id: '$type', n: { $sum: 1 } } },
                { $sort: { n: -1 } },
                { $limit: 20 },
              ],
            },
          },
        ])
        .toArray()
        .then((arr) => arr[0] || {}),
      col
        .aggregate([
          { $match: { match_status: 'matched', textbook: { $exists: true, $ne: '' } } },
          { $group: { _id: '$textbook', n: { $sum: 1 } } },
          { $sort: { n: -1 } },
          { $limit: 10 },
        ])
        .toArray(),
    ]);

    // shortage 판정 — items 에 포함된 (passage_id, type) 쌍 중 generated_questions 에 없는 것
    const pairs: { passage_id: ObjectId; type: string }[] = [];
    for (const it of items) {
      const pid = (it as { passage_id?: unknown }).passage_id;
      const t = (it as { type?: unknown }).type;
      if (pid instanceof ObjectId && typeof t === 'string') {
        pairs.push({ passage_id: pid, type: t });
      }
    }
    const existsKeys = new Set<string>();
    if (pairs.length > 0) {
      const orConds = pairs.map((p) => ({ passage_id: p.passage_id, type: p.type }));
      const rows = await gqCol
        .find({ $or: orConds }, { projection: { passage_id: 1, type: 1 } })
        .toArray();
      for (const r of rows) {
        const pid = (r as { passage_id?: ObjectId }).passage_id;
        const t = (r as { type?: string }).type;
        if (pid && t) existsKeys.add(`${String(pid)}::${t}`);
      }
    }

    const itemsOut = items
      .map((raw) => {
        const doc = raw as Record<string, unknown>;
        const pid = doc.passage_id;
        const t = doc.type as string | undefined;
        const key = pid instanceof ObjectId && t ? `${String(pid)}::${t}` : '';
        const is_shortage_candidate =
          doc.match_status === 'matched' &&
          !doc.promoted_to &&
          !!key &&
          !existsKeys.has(key);
        return { ...serializeGuestLog(doc), is_shortage_candidate };
      })
      .filter((d) => !needsShortageOnly || d.is_shortage_candidate === true);

    const statsOut = {
      total: (statsAgg as { all?: { n?: number }[] }).all?.[0]?.n || 0,
      matched: (statsAgg as { matched?: { n?: number }[] }).matched?.[0]?.n || 0,
      unknown: (statsAgg as { unknown?: { n?: number }[] }).unknown?.[0]?.n || 0,
      last_7d: (statsAgg as { last_7d?: { n?: number }[] }).last_7d?.[0]?.n || 0,
      unique_ip: (statsAgg as { unique_ip?: { n?: number }[] }).unique_ip?.[0]?.n || 0,
      by_type:
        (statsAgg as { by_type?: { _id: string; n: number }[] }).by_type?.map((r) => ({
          type: r._id,
          count: r.n,
        })) || [],
      top_textbooks: topTextbooks.map((r) => ({
        textbook: (r as { _id?: string })._id || '',
        count: (r as { n?: number }).n || 0,
      })),
    };

    return NextResponse.json({ items: itemsOut, total, page, limit, stats: statsOut });
  } catch (e) {
    console.error('guest-variant-logs GET:', e);
    return NextResponse.json({ error: '조회 실패' }, { status: 500 });
  }
}

/**
 * 오래된 로그 일괄 삭제.
 * ?older_than=30d  (일 단위만 지원)
 */
export async function DELETE(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const sp = request.nextUrl.searchParams;
  const olderThan = sp.get('older_than')?.trim() || '';
  const m = /^(\d+)d$/i.exec(olderThan);
  if (!m) {
    return NextResponse.json(
      { error: 'older_than=30d 처럼 일 단위로 지정해 주세요.' },
      { status: 400 },
    );
  }
  const days = Math.min(3650, Math.max(1, parseInt(m[1], 10) || 0));
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  try {
    const db = await getDb('gomijoshua');
    const r = await db
      .collection(GUEST_GENERATED_QUESTIONS_COLLECTION)
      .deleteMany({ created_at: { $lt: cutoff } });
    return NextResponse.json({ ok: true, deleted: r.deletedCount });
  } catch (e) {
    console.error('guest-variant-logs DELETE older:', e);
    return NextResponse.json({ error: '삭제 실패' }, { status: 500 });
  }
}
