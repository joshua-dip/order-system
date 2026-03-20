import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';

function variationRatio(original: string, paragraph: string): number {
  const a = original.trim();
  const b = paragraph.trim();
  if (a.length === 0 && b.length === 0) return 0;
  const maxLen = Math.max(a.length, b.length, 1);
  const d = levenshtein(a, b);
  return Math.min(1, d / maxLen);
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      curr[j] =
        a[i - 1] === b[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
    }
    prev = curr;
  }
  return prev[n];
}

const BUCKETS = 10; // 0-10, 10-20, ..., 90-100
const MAX_SCAN = 3000;

/**
 * 유형별 변형도 집계: 평균, 최소, 최대, 구간별 분포.
 * 상단 필터(textbook, type)와 동일하게 적용.
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { searchParams } = request.nextUrl;
  const textbook = searchParams.get('textbook')?.trim() || '';
  const typeFilter = searchParams.get('type')?.trim() || '';
  const limit = Math.min(MAX_SCAN, Math.max(1, parseInt(searchParams.get('limit') || String(MAX_SCAN), 10) || MAX_SCAN));

  const filter: Record<string, unknown> = {
    passage_id: { $exists: true, $ne: null },
    'question_data.Paragraph': { $exists: true, $type: 'string' },
  };
  if (textbook) filter.textbook = textbook;
  if (typeFilter) filter.type = typeFilter;

  try {
    const db = await getDb('gomijoshua');
    const col = db.collection('generated_questions');
    const items = await col
      .find(filter)
      .project({ type: 1, passage_id: 1, 'question_data.Paragraph': 1 })
      .limit(limit)
      .toArray();

    const passageIds = [
      ...new Set(
        (items as { passage_id?: unknown }[])
          .map((d) => d.passage_id)
          .filter((id): id is ObjectId => id instanceof ObjectId),
      ),
    ];
    const passageMap = new Map<string, string>();
    if (passageIds.length > 0) {
      const passages = await db
        .collection('passages')
        .find({ _id: { $in: passageIds } })
        .project({ _id: 1, 'content.original': 1, 'content.mixed': 1 })
        .toArray();
      for (const p of passages) {
        const id = String(p._id);
        const content = (p as { content?: { original?: string; mixed?: string } }).content;
        const text =
          (typeof content?.original === 'string' && content.original.trim()) ||
          (typeof content?.mixed === 'string' && content.mixed.trim()) ||
          '';
        passageMap.set(id, text);
      }
    }

    type TypeStats = {
      count: number;
      sum: number;
      min: number;
      max: number;
      distribution: number[];
    };
    const byType = new Map<string, TypeStats>();

    for (const d of items as Record<string, unknown>[]) {
      const passageId = d.passage_id;
      const pid = passageId == null ? '' : typeof passageId === 'string' ? passageId : String(passageId);
      const orig = pid ? passageMap.get(pid) ?? '' : '';
      const para =
        typeof (d.question_data as Record<string, unknown>)?.Paragraph === 'string'
          ? ((d.question_data as Record<string, unknown>).Paragraph as string)
          : '';
      const ratio = variationRatio(orig, para);
      const pct = Math.round(ratio * 100);
      const typeKey = String(d.type ?? '').trim() || '—';

      let stats = byType.get(typeKey);
      if (!stats) {
        stats = { count: 0, sum: 0, min: 100, max: 0, distribution: Array(BUCKETS).fill(0) };
        byType.set(typeKey, stats);
      }
      stats.count += 1;
      stats.sum += pct;
      stats.min = Math.min(stats.min, pct);
      stats.max = Math.max(stats.max, pct);
      const bucketIdx = Math.min(BUCKETS - 1, Math.floor(pct / 10));
      stats.distribution[bucketIdx] += 1;
    }

    const result: Record<string, { count: number; avg: number; min: number; max: number; distribution: number[] }> = {};
    for (const [typeKey, stats] of byType.entries()) {
      result[typeKey] = {
        count: stats.count,
        avg: stats.count > 0 ? Math.round((stats.sum / stats.count) * 10) / 10 : 0,
        min: stats.count > 0 ? stats.min : 0,
        max: stats.count > 0 ? stats.max : 0,
        distribution: stats.distribution,
      };
    }

    return NextResponse.json({
      ok: true,
      totalScanned: items.length,
      filters: { textbook: textbook || null, type: typeFilter || null },
      byType: result,
    });
  } catch (e) {
    console.error('analyze variation GET:', e);
    return NextResponse.json({ error: '변형도 분석에 실패했습니다.' }, { status: 500 });
  }
}
