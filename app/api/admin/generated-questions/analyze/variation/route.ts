import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import {
  parseCompareMaxChars,
  parseDocChunkSize,
  parsePassageFetchBatch,
  parseVariationScanCap,
  variationPercentAggregate,
} from '@/lib/admin-variation-aggregate';
import {
  getPassageTextForVariantCompare,
  passageIdToValidHex,
} from '@/lib/passage-variant-text';
import { buildVariationAnalysisFilter } from '@/lib/variation-analysis-filter';

const BUCKETS = 10; // 0-10, 10-20, ..., 90-100

const VARIATION_SCAN_CAP = parseVariationScanCap();
const DOC_CHUNK = parseDocChunkSize();
const PASSAGE_FETCH_BATCH = parsePassageFetchBatch();
const COMPARE_MAX_CHARS = parseCompareMaxChars();

/**
 * 유형별 변형도 집계: 평균, 최소, 최대, 구간별 분포.
 * 상단 필터(textbook, type)와 동일하게 적용.
 * — 문서는 청크로 모아 passages를 배치 조회(지문당 1회 쿼리 폭주 방지).
 * — `limit` 쿼리(기본=상한까지) · `ADMIN_VARIATION_MAX_SCAN` 환경변수로 상한 조절(3000~200000).
 * — `skipTotal=1`: countDocuments 생략(대량 컬렉션에서 수 초~수십 초 절약).
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { searchParams } = request.nextUrl;
  const textbook = searchParams.get('textbook')?.trim() || '';
  const typeFilter = searchParams.get('type')?.trim() || '';
  const limitParam = parseInt(searchParams.get('limit') || String(VARIATION_SCAN_CAP), 10) || VARIATION_SCAN_CAP;
  const limit = Math.min(VARIATION_SCAN_CAP, Math.max(1, limitParam));
  const debug = searchParams.get('debug') === '1';
  const skipTotal = searchParams.get('skipTotal') === '1';

  const filter = buildVariationAnalysisFilter(textbook, typeFilter);

  try {
    const db = await getDb('gomijoshua');
    const col = db.collection('generated_questions');
    const passagesCol = db.collection('passages');

    const totalMatching = skipTotal ? null : await col.countDocuments(filter);

    const passageCache = new Map<string, string>();

    async function fetchPassagesIntoCache(ids: string[]) {
      const need = [...new Set(ids)].filter((id) => ObjectId.isValid(id) && !passageCache.has(id));
      if (need.length === 0) return;
      for (let i = 0; i < need.length; i += PASSAGE_FETCH_BATCH) {
        const slice = need.slice(i, i + PASSAGE_FETCH_BATCH);
        const oids = slice.map((id) => new ObjectId(id));
        const arr = await passagesCol
          .find({ _id: { $in: oids } })
          .project({ _id: 1, 'content.original': 1, 'content.mixed': 1, 'content.translation': 1 })
          .toArray();
        const found = new Set<string>();
        for (const p of arr) {
          const id = String(p._id);
          const content = (p as { content?: Record<string, unknown> }).content;
          const text = getPassageTextForVariantCompare(content);
          passageCache.set(id, text);
          found.add(id);
        }
        for (const id of slice) {
          if (!found.has(id)) passageCache.set(id, '');
        }
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

    function ingestDocs(docs: Record<string, unknown>[]) {
      const passageIds: string[] = [];
      for (const d of docs) {
        const pid = passageIdToValidHex(d.passage_id);
        if (pid) passageIds.push(pid);
      }
      return passageIds;
    }

    function processDocs(
      docs: Record<string, unknown>[],
      dbg: { invalidPassageId: number; emptyPassageText: number }
    ) {
      for (const d of docs) {
        const passageId = d.passage_id;
        const pid = passageIdToValidHex(passageId);

        if (debug) {
          if (!pid) dbg.invalidPassageId += 1;
        }

        const orig = pid ? (passageCache.get(pid) ?? '') : '';
        if (debug && pid && !orig.trim()) dbg.emptyPassageText += 1;

        const qd = d.question_data as Record<string, unknown> | undefined;
        const para = typeof qd?.Paragraph === 'string' ? (qd.Paragraph as string) : '';
        const typeKey = String(d.type ?? '').trim() || '—';
        const pct = variationPercentAggregate(typeKey, orig, para, qd, COMPARE_MAX_CHARS);

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
    }

    const cursor = col
      .find(filter)
      .project({
        type: 1,
        passage_id: 1,
        'question_data.Paragraph': 1,
        'question_data.Options': 1,
        'question_data.CorrectAnswer': 1,
      })
      .batchSize(Math.min(800, DOC_CHUNK * 2));

    let scanned = 0;
    let dbgInvalidPassageId = 0;
    let dbgEmptyPassageText = 0;
    const dbg = { invalidPassageId: 0, emptyPassageText: 0 };

    let docBuffer: Record<string, unknown>[] = [];

    async function flushBuffer() {
      if (docBuffer.length === 0) return;
      const ids = ingestDocs(docBuffer);
      await fetchPassagesIntoCache(ids);
      processDocs(docBuffer, dbg);
      docBuffer = [];
    }

    for await (const d of cursor as AsyncIterable<Record<string, unknown>>) {
      if (scanned >= limit) break;
      scanned += 1;
      docBuffer.push(d);
      if (docBuffer.length >= DOC_CHUNK) {
        await flushBuffer();
      }
    }
    await flushBuffer();

    if (debug) {
      dbgInvalidPassageId = dbg.invalidPassageId;
      dbgEmptyPassageText = dbg.emptyPassageText;
    }

    const result: Record<string, { count: number; avg: number; min: number; max: number; distribution: number[] }> =
      {};
    for (const [typeKey, stats] of byType.entries()) {
      result[typeKey] = {
        count: stats.count,
        avg: stats.count > 0 ? Math.round((stats.sum / stats.count) * 10) / 10 : 0,
        min: stats.count > 0 ? stats.min : 0,
        max: stats.count > 0 ? stats.max : 0,
        distribution: stats.distribution,
      };
    }

    const scanCapped = totalMatching != null && totalMatching > scanned;

    return NextResponse.json({
      ok: true,
      totalScanned: scanned,
      totalMatching,
      scanLimit: limit,
      scanCap: VARIATION_SCAN_CAP,
      scanCapped,
      filters: { textbook: textbook || null, type: typeFilter || null },
      byType: result,
      performance: {
        docChunk: DOC_CHUNK,
        passageFetchBatch: PASSAGE_FETCH_BATCH,
        compareMaxChars: COMPARE_MAX_CHARS,
        totalCountSkipped: skipTotal,
      },
      ...(debug
        ? {
            diagnostics: {
              invalidPassageId: dbgInvalidPassageId,
              emptyPassageSourceText: dbgEmptyPassageText,
              note: 'empty: 원문 passages가 없거나, original·mixed·translation이 모두 비어 있음. invalidPassageId: passage_id가 유효 ObjectId가 아님.',
            },
          }
        : {}),
    });
  } catch (e) {
    console.error('analyze variation GET:', e);
    return NextResponse.json({ error: '변형도 분석에 실패했습니다.' }, { status: 500 });
  }
}
