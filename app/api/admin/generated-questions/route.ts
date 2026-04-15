import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { GRAMMAR_VARIANT_OPTIONS_FIXED } from '@/lib/variant-draft-grammar-rules';
import { variationPercentAgainstOriginal } from '@/lib/paragraph-variation';
import { getPassageTextForVariantCompare, passageIdToValidHex } from '@/lib/passage-variant-text';
import { buildNarrativeQuestionsFilter, mapNarrativeDocToListRow } from '@/lib/admin-narrative-questions-list';
import { buildVariantQFilter } from '@/lib/admin-generated-questions-q-filter';
import { normalizeMockVariantSourceLabel } from '@/lib/mock-variant-source-normalize';

function serialize(doc: Record<string, unknown>, variation_pct?: number | null) {
  const { _id, passage_id, ...rest } = doc;
  const out: Record<string, unknown> = {
    ...rest,
    _id: String(_id),
    passage_id: passage_id ? String(passage_id) : null,
    created_at: doc.created_at ?? null,
    updated_at: doc.updated_at ?? null,
  };
  if (variation_pct != null) (out as Record<string, unknown>).variation_pct = variation_pct;
  return out;
}

function buildVariantFilter(opts: {
  textbook: string;
  type: string;
  status: string;
  difficulty: string;
  passageId: string;
  q: string;
}): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  if (opts.textbook) filter.textbook = opts.textbook;
  if (opts.type) filter.type = opts.type;
  if (opts.status) filter.status = opts.status;
  if (opts.difficulty) filter.difficulty = opts.difficulty;
  if (opts.passageId && ObjectId.isValid(opts.passageId)) {
    filter.passage_id = new ObjectId(opts.passageId);
  }
  if (opts.q) {
    const qf = buildVariantQFilter(opts.q);
    if (qf) {
      const prev = filter.$and;
      filter.$and = [...(Array.isArray(prev) ? prev : []), qf];
    }
  }
  return filter;
}

function serializeListRows(
  items: Record<string, unknown>[],
  passageMap: Map<string, string>
): Record<string, unknown>[] {
  return items.map((d) => {
    const kind = d.record_kind;
    if (kind === 'narrative') {
      return serialize({ ...d, record_kind: 'narrative' }, null);
    }
    const pid = passageIdToValidHex(d.passage_id);
    const orig = pid ? (passageMap.get(pid) ?? '') : '';
    const qd = d.question_data as Record<string, unknown> | undefined;
    const para = typeof qd?.Paragraph === 'string' ? (qd.Paragraph as string) : '';
    const typeStr = String(d.type ?? '').trim();
    const variation_pct = variationPercentAgainstOriginal(typeStr, orig, para, qd);
    const row = { ...d, record_kind: 'variant' };
    return serialize(row, variation_pct);
  });
}

async function loadPassageMapForRows(
  db: Awaited<ReturnType<typeof getDb>>,
  items: Record<string, unknown>[]
): Promise<Map<string, string>> {
  const idHexSet = new Set<string>();
  for (const d of items) {
    const h = passageIdToValidHex(d.passage_id);
    if (h) idHexSet.add(h);
  }
  const passageOids = [...idHexSet].map((h) => new ObjectId(h));
  const passageMap = new Map<string, string>();
  if (passageOids.length > 0) {
    const passagesCol = db.collection('passages');
    const passages = await passagesCol
      .find({ _id: { $in: passageOids } })
      .project({ _id: 1, 'content.original': 1, 'content.mixed': 1, 'content.translation': 1 })
      .toArray();
    for (const p of passages) {
      const id = String(p._id);
      const content = (p as { content?: Record<string, unknown> }).content;
      passageMap.set(id, getPassageTextForVariantCompare(content));
    }
    for (const oid of passageOids) {
      const k = oid.toString();
      if (!passageMap.has(k)) passageMap.set(k, '');
    }
  }
  return passageMap;
}

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { searchParams } = request.nextUrl;
  const textbook = searchParams.get('textbook')?.trim() || '';
  const type = searchParams.get('type')?.trim() || '';
  const status = searchParams.get('status')?.trim() || '';
  const difficulty = searchParams.get('difficulty')?.trim() || '';
  const passageId = searchParams.get('passage_id')?.trim() || '';
  const q = searchParams.get('q')?.trim() || '';
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '25', 10) || 25));
  const skip = (page - 1) * limit;
  /** default: 교재·출처·유형 순(기존) / newest: 생성일 최신순 */
  const sortMode = searchParams.get('sort')?.trim().toLowerCase() === 'newest' ? 'newest' : 'default';
  const dataScopeRaw = searchParams.get('data_scope')?.trim().toLowerCase() || 'variant';
  const dataScope =
    dataScopeRaw === 'narrative' || dataScopeRaw === 'all' ? dataScopeRaw : 'variant';

  const variantFilter = buildVariantFilter({ textbook, type, status, difficulty, passageId, q });
  const narrFilter = buildNarrativeQuestionsFilter({
    textbook,
    type,
    passageIdHex: passageId,
    q,
  });

  const sortSpec =
    sortMode === 'newest'
      ? ({ created_at: -1, _id: -1 } as Record<string, 1 | -1>)
      : ({ textbook: 1, source: 1, type: 1, created_at: -1, _id: -1 } as Record<string, 1 | -1>);

  try {
    const db = await getDb('gomijoshua');
    const col = db.collection('generated_questions');
    const narrCol = db.collection('narrative_questions');

    if (dataScope === 'narrative') {
      const [total, raw] = await Promise.all([
        narrCol.countDocuments(narrFilter),
        narrCol
          .find(narrFilter)
          .sort(sortSpec)
          .skip(skip)
          .limit(limit)
          .toArray(),
      ]);
      const items = raw.map((d) => mapNarrativeDocToListRow(d as Record<string, unknown>));
      return NextResponse.json({
        items,
        total,
        page,
        limit,
        data_scope: 'narrative',
      });
    }

    if (dataScope === 'all') {
      const variantPipeline: Record<string, unknown>[] = [
        { $match: variantFilter },
        { $addFields: { record_kind: 'variant' } },
        {
          $project: {
            textbook: 1,
            passage_id: 1,
            source: 1,
            type: 1,
            option_type: 1,
            difficulty: 1,
            status: 1,
            created_at: 1,
            record_kind: 1,
            question_data: {
              Question: '$question_data.Question',
              Paragraph: '$question_data.Paragraph',
              NumQuestion: '$question_data.NumQuestion',
              Category: '$question_data.Category',
              Options: '$question_data.Options',
              CorrectAnswer: '$question_data.CorrectAnswer',
              Explanation: '$question_data.Explanation',
            },
          },
        },
      ];
      const narrativePipeline: Record<string, unknown>[] = [
        { $match: narrFilter },
        {
          $addFields: {
            record_kind: 'narrative',
            source: { $ifNull: ['$source_key_matched', '$source_file'] },
            type: '$narrative_subtype',
            option_type: '서술형',
            status: { $ifNull: ['$excel_row_status', ''] },
            question_data: {
              Question: '$question_data.문제',
              Paragraph: { $ifNull: ['$question_data.본문', '$question_data.원문'] },
              Options: '$question_data.모범답안',
              Explanation: '$question_data.해설',
              Category: '$question_data.문제유형',
              NumQuestion: '$question_data.번호',
            },
          },
        },
        {
          $project: {
            textbook: 1,
            passage_id: 1,
            source: 1,
            type: 1,
            option_type: 1,
            difficulty: 1,
            status: 1,
            created_at: 1,
            record_kind: 1,
            question_data: 1,
          },
        },
      ];

      const [countAgg, listAgg] = await Promise.all([
        col
          .aggregate([
            { $match: variantFilter },
            { $project: { _id: 1 } },
            {
              $unionWith: {
                coll: 'narrative_questions',
                pipeline: [{ $match: narrFilter }, { $project: { _id: 1 } }],
              },
            },
            { $count: 'n' },
          ])
          .toArray(),
        col
          .aggregate([
            ...variantPipeline,
            {
              $unionWith: {
                coll: 'narrative_questions',
                pipeline: narrativePipeline,
              },
            },
            { $sort: sortSpec },
            { $skip: skip },
            { $limit: limit },
          ])
          .toArray(),
      ]);

      const total = typeof countAgg[0]?.n === 'number' ? countAgg[0].n : 0;
      const items = listAgg as Record<string, unknown>[];
      const passageMap = await loadPassageMapForRows(db, items);
      const serialized = serializeListRows(items, passageMap);

      return NextResponse.json({
        items: serialized,
        total,
        page,
        limit,
        data_scope: 'all',
      });
    }

    // variant (default)
    const [total, items] = await Promise.all([
      col.countDocuments(variantFilter),
      col
        .find(variantFilter)
        .sort(sortSpec)
        .skip(skip)
        .limit(limit)
        .project({
          textbook: 1,
          passage_id: 1,
          source: 1,
          type: 1,
          option_type: 1,
          difficulty: 1,
          created_at: 1,
          'question_data.Question': 1,
          'question_data.Paragraph': 1,
          'question_data.NumQuestion': 1,
          'question_data.Category': 1,
          'question_data.Options': 1,
          'question_data.CorrectAnswer': 1,
          'question_data.Explanation': 1,
        })
        .toArray(),
    ]);

    const withKind = (items as Record<string, unknown>[]).map((d) => ({ ...d, record_kind: 'variant' }));
    const passageMap = await loadPassageMapForRows(db, withKind);
    const serialized = serializeListRows(withKind, passageMap);

    return NextResponse.json({
      items: serialized,
      total,
      page,
      limit,
      data_scope: 'variant',
    });
  } catch (e) {
    console.error('generated-questions GET:', e);
    return NextResponse.json({ error: '목록 조회에 실패했습니다.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const body = await request.json();
    const textbook = typeof body.textbook === 'string' ? body.textbook.trim() : '';
    const passageIdStr = typeof body.passage_id === 'string' ? body.passage_id.trim() : '';
    let source = typeof body.source === 'string' ? body.source.trim() : '';
    const type = typeof body.type === 'string' ? body.type.trim() : '';

    if (!textbook || !passageIdStr || !ObjectId.isValid(passageIdStr)) {
      return NextResponse.json({ error: '교재명과 유효한 passage_id(ObjectId)는 필수입니다.' }, { status: 400 });
    }
    if (!source || !type) {
      return NextResponse.json({ error: 'source(출처)와 유형(type)은 필수입니다.' }, { status: 400 });
    }

    source = normalizeMockVariantSourceLabel(textbook, source);

    let question_data: Record<string, unknown> = {};
    if (body.question_data && typeof body.question_data === 'object' && !Array.isArray(body.question_data)) {
      question_data = body.question_data as Record<string, unknown>;
    } else if (typeof body.question_data_json === 'string' && body.question_data_json.trim()) {
      try {
        question_data = JSON.parse(body.question_data_json) as Record<string, unknown>;
      } catch {
        return NextResponse.json({ error: 'question_data JSON 형식이 올바르지 않습니다.' }, { status: 400 });
      }
    }

    const option_type = typeof body.option_type === 'string' ? body.option_type.trim() : 'English';
    const docStatus = typeof body.status === 'string' && body.status.trim() ? body.status.trim() : '완료';
    const difficulty = typeof body.difficulty === 'string' && body.difficulty.trim()
      ? body.difficulty.trim()
      : (typeof question_data?.DifficultyLevel === 'string' ? (question_data.DifficultyLevel as string) : '중');

    if (typeof question_data.Source === 'string' && question_data.Source.trim()) {
      question_data = {
        ...question_data,
        Source: normalizeMockVariantSourceLabel(textbook, question_data.Source.trim()),
      };
    }

    const error_msg =
      body.error_msg === null || body.error_msg === undefined
        ? null
        : typeof body.error_msg === 'string'
          ? body.error_msg
          : String(body.error_msg);

    if (type === '어법') {
      question_data = { ...question_data, Options: GRAMMAR_VARIANT_OPTIONS_FIXED };
    }

    const now = new Date();
    const doc = {
      textbook,
      passage_id: new ObjectId(passageIdStr),
      source,
      type,
      option_type,
      difficulty,
      question_data,
      status: docStatus,
      error_msg,
      created_at: now,
      updated_at: now,
    };

    const db = await getDb('gomijoshua');
    const r = await db.collection('generated_questions').insertOne(doc);
    const inserted = await db.collection('generated_questions').findOne({ _id: r.insertedId });
    return NextResponse.json({
      ok: true,
      item: inserted ? serialize(inserted as Record<string, unknown>) : null,
    });
  } catch (e) {
    console.error('generated-questions POST:', e);
    return NextResponse.json({ error: '등록에 실패했습니다.' }, { status: 500 });
  }
}
