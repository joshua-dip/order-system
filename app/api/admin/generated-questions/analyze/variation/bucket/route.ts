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
  pctMatchesBucket,
  bucketLabel,
} from '@/lib/admin-variation-aggregate';
import { getPassageTextForVariantCompare, passageIdToValidHex } from '@/lib/passage-variant-text';

const VARIATION_SCAN_CAP = parseVariationScanCap();
const DOC_CHUNK = parseDocChunkSize();
const PASSAGE_FETCH_BATCH = parsePassageFetchBatch();
const COMPARE_MAX_CHARS = parseCompareMaxChars();

function paragraphPreview(para: string, max = 160): string {
  const t = para.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

/**
 * 변형도 집계 테이블의 구간(또는 전체)에 해당하는 문항 목록.
 * 집계 API와 동일한 필터·동일한 변형도 계산식(variationPercentAggregate).
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { searchParams } = request.nextUrl;
  const textbook = searchParams.get('textbook')?.trim() || '';
  const typeParam = searchParams.get('type')?.trim() ?? '';
  const typeEmpty = searchParams.get('typeEmpty') === '1';
  const bucketRaw = (searchParams.get('bucket') ?? '0').trim().toLowerCase();
  const bucketAll = bucketRaw === 'all';
  const bucketNum = bucketAll ? -1 : parseInt(bucketRaw, 10);
  if (!bucketAll && (Number.isNaN(bucketNum) || bucketNum < 0 || bucketNum > 9)) {
    return NextResponse.json({ error: 'bucket은 0~9 또는 all 이어야 합니다.' }, { status: 400 });
  }

  const maxResults = Math.min(2000, Math.max(1, parseInt(searchParams.get('maxResults') || '500', 10) || 500));
  const maxScan = Math.min(
    VARIATION_SCAN_CAP,
    Math.max(maxResults, parseInt(searchParams.get('maxScan') || String(VARIATION_SCAN_CAP), 10) || VARIATION_SCAN_CAP)
  );

  const filter: Record<string, unknown> = {
    passage_id: { $exists: true, $ne: null },
    'question_data.Paragraph': { $exists: true, $type: 'string' },
  };
  if (textbook) filter.textbook = textbook;
  if (typeEmpty) {
    filter.$or = [{ type: { $exists: false } }, { type: null }, { type: '' }];
  } else if (typeParam) {
    filter.type = typeParam;
  }

  try {
    const db = await getDb('gomijoshua');
    const col = db.collection('generated_questions');
    const passagesCol = db.collection('passages');

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
          passageCache.set(id, getPassageTextForVariantCompare(content));
          found.add(id);
        }
        for (const id of slice) {
          if (!found.has(id)) passageCache.set(id, '');
        }
      }
    }

    function ingestIds(docs: Record<string, unknown>[]) {
      const passageIds: string[] = [];
      for (const d of docs) {
        const pid = passageIdToValidHex(d.passage_id);
        if (pid) passageIds.push(pid);
      }
      return passageIds;
    }

    type Item = {
      _id: string;
      textbook: string;
      source: string;
      type: string;
      variation_pct: number;
      paragraphPreview: string;
      created_at: unknown;
      passage_id: string | null;
    };

    const items: Item[] = [];
    let totalRead = 0;
    let scanStoppedReason: 'maxResults' | 'maxScan' | 'complete' = 'complete';

    async function processChunk(docs: Record<string, unknown>[]): Promise<boolean> {
      if (docs.length === 0) return false;
      await fetchPassagesIntoCache(ingestIds(docs));
      for (const d of docs) {
        const pid = passageIdToValidHex(d.passage_id);
        const orig = pid ? (passageCache.get(pid) ?? '') : '';
        const qd = d.question_data as Record<string, unknown> | undefined;
        const para = typeof qd?.Paragraph === 'string' ? (qd.Paragraph as string) : '';
        const typeKey = String(d.type ?? '').trim() || '—';

        if (typeEmpty && String(d.type ?? '').trim() !== '') continue;

        const pct = variationPercentAggregate(typeKey, orig, para, qd, COMPARE_MAX_CHARS);
        const inBucket = bucketAll || pctMatchesBucket(pct, bucketNum);
        if (!inBucket) continue;

        items.push({
          _id: String(d._id),
          textbook: String(d.textbook ?? ''),
          source: String(d.source ?? ''),
          type: typeKey,
          variation_pct: pct,
          paragraphPreview: paragraphPreview(para),
          created_at: d.created_at ?? null,
          passage_id: pid,
        });

        if (items.length >= maxResults) {
          scanStoppedReason = 'maxResults';
          return true;
        }
      }
      return false;
    }

    const cursor = col
      .find(filter)
      .project({
        type: 1,
        passage_id: 1,
        textbook: 1,
        source: 1,
        created_at: 1,
        'question_data.Paragraph': 1,
        'question_data.Options': 1,
        'question_data.CorrectAnswer': 1,
      })
      .batchSize(Math.min(800, DOC_CHUNK * 2));

    let buffer: Record<string, unknown>[] = [];

    outer: for await (const d of cursor as AsyncIterable<Record<string, unknown>>) {
      if (totalRead >= maxScan) {
        scanStoppedReason = 'maxScan';
        break;
      }
      totalRead += 1;
      buffer.push(d);
      if (buffer.length >= DOC_CHUNK) {
        const stop = await processChunk(buffer);
        buffer = [];
        if (stop) break outer;
      }
    }

    if (buffer.length > 0) {
      await processChunk(buffer);
    }

    return NextResponse.json({
      ok: true,
      items,
      scanned: totalRead,
      maxScan,
      maxResults,
      scanStoppedReason,
      bucket: bucketAll ? 'all' : bucketNum,
      bucketLabel: bucketAll ? '전체 구간' : bucketLabel(bucketNum),
      filters: {
        textbook: textbook || null,
        type: typeEmpty ? null : typeParam || null,
        typeEmpty,
      },
      performance: {
        docChunk: DOC_CHUNK,
        compareMaxChars: COMPARE_MAX_CHARS,
      },
    });
  } catch (e) {
    console.error('variation bucket GET:', e);
    return NextResponse.json({ error: '구간 문항 목록을 불러오지 못했습니다.' }, { status: 500 });
  }
}
