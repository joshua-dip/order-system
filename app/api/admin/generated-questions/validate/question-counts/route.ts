import { NextRequest, NextResponse } from 'next/server';
import { ObjectId, type Collection, type Document } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import {
  BOOK_VARIANT_QUESTION_TYPES,
  DEFAULT_QUESTIONS_PER_VARIANT_TYPE,
} from '@/lib/book-variant-types';
import { buildQuestionCountReport } from '@/lib/question-count-report';

const MAX_LIST_ROWS = 2500;

async function aggregateCountsByPassageAndType(gqCol: Collection<Document>, ids: ObjectId[]) {
  if (ids.length === 0) {
    return new Map<string, Map<string, number>>();
  }
  const agg = await gqCol
    .aggregate([
      { $match: { passage_id: { $in: ids } } },
      {
        $group: {
          _id: { pid: '$passage_id', typ: '$type' },
          c: { $sum: 1 },
        },
      },
    ])
    .toArray();

  const countMap = new Map<string, Map<string, number>>();
  for (const row of agg) {
    const idObj = row._id as { pid?: unknown; typ?: unknown };
    const pid = String(idObj.pid ?? '');
    const typ = String(idObj.typ ?? '');
    if (!countMap.has(pid)) countMap.set(pid, new Map());
    countMap.get(pid)!.set(typ, Number(row.c) || 0);
  }
  return countMap;
}

/**
 * passages(원문) 기준 변형문 집계.
 * - textbook: 해당 교재 전체 지문
 * - orderId: 주문서 orderMeta(bookVariant)의 선택 지문·유형·문항수 기준
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const orderIdRaw = request.nextUrl.searchParams.get('orderId')?.trim() || '';
  const textbookParam = request.nextUrl.searchParams.get('textbook')?.trim() || '';
  const requiredPerTypeRaw = request.nextUrl.searchParams.get('requiredPerType');
  const requiredPerTypeDefault = Math.max(
    1,
    Math.min(
      20,
      parseInt(requiredPerTypeRaw || String(DEFAULT_QUESTIONS_PER_VARIANT_TYPE), 10) ||
        DEFAULT_QUESTIONS_PER_VARIANT_TYPE
    )
  );

  try {
    const db = await getDb('gomijoshua');
    const passagesCol = db.collection('passages');
    const gqCol = db.collection('generated_questions');

    let textbook = '';
    type PDoc = {
      _id: ObjectId;
      textbook?: unknown;
      chapter?: unknown;
      number?: unknown;
      source_key?: unknown;
    };
    let passageDocs: PDoc[] = [];
    let typesToCheck: string[] = [...BOOK_VARIANT_QUESTION_TYPES];
    let requiredPerType = requiredPerTypeDefault;
    let scope: 'textbook' | 'order' = 'textbook';
    let orderInfo: {
      id: string;
      orderNumber: string | null;
      flow: string;
    } | null = null;
    let lessonsWithoutPassage: string[] = [];
    let orderLessonsRequested = 0;

    if (orderIdRaw) {
      if (!ObjectId.isValid(orderIdRaw)) {
        return NextResponse.json({ error: '유효한 orderId가 아닙니다.' }, { status: 400 });
      }
      const order = await db.collection('orders').findOne({ _id: new ObjectId(orderIdRaw) });
      if (!order) {
        return NextResponse.json({ error: '주문을 찾을 수 없습니다.' }, { status: 404 });
      }
      const meta = order.orderMeta;
      if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
        return NextResponse.json(
          { error: '이 주문에는 orderMeta가 없어 지문 목록을 알 수 없습니다.' },
          { status: 400 }
        );
      }
      const m = meta as Record<string, unknown>;
      const flow = typeof m.flow === 'string' ? m.flow : '';
      if (flow !== 'bookVariant') {
        return NextResponse.json(
          {
            error:
              '부교재 변형(bookVariant) 주문만 지원합니다. (모의고사·워크북 주문은 orderMeta 구조가 달라 추후 확장 가능)',
            flow: flow || null,
          },
          { status: 400 }
        );
      }

      textbook = typeof m.selectedTextbook === 'string' ? m.selectedTextbook.trim() : '';
      const selectedLessons = Array.isArray(m.selectedLessons)
        ? m.selectedLessons.filter((x): x is string => typeof x === 'string')
        : [];
      const selectedTypes = Array.isArray(m.selectedTypes)
        ? m.selectedTypes.filter((x): x is string => typeof x === 'string')
        : [];
      const qpt =
        typeof m.questionsPerType === 'number' && Number.isFinite(m.questionsPerType) && m.questionsPerType > 0
          ? Math.min(20, Math.floor(m.questionsPerType))
          : DEFAULT_QUESTIONS_PER_VARIANT_TYPE;

      if (!textbook) {
        return NextResponse.json({ error: '주문 메타에 교재명(selectedTextbook)이 없습니다.' }, { status: 400 });
      }
      if (selectedLessons.length === 0) {
        return NextResponse.json({ error: '주문에 선택된 지문(selectedLessons)이 없습니다.' }, { status: 400 });
      }

      orderLessonsRequested = selectedLessons.length;
      const normalizedLessons = [...new Set(selectedLessons.map((l) => l.trim()).filter(Boolean))];

      passageDocs = (await passagesCol
        .find({ textbook, source_key: { $in: normalizedLessons } })
        .project({ _id: 1, textbook: 1, chapter: 1, number: 1, source_key: 1 })
        .toArray()) as PDoc[];

      const matchedKeys = new Set(
        passageDocs.map((p) => (typeof p.source_key === 'string' ? p.source_key.trim() : ''))
      );
      lessonsWithoutPassage = normalizedLessons.filter((l) => !matchedKeys.has(l));

      typesToCheck =
        selectedTypes.length > 0
          ? [...new Set(selectedTypes.map((t) => t.trim()).filter(Boolean))]
          : [...BOOK_VARIANT_QUESTION_TYPES];
      requiredPerType = qpt;
      scope = 'order';
      orderInfo = {
        id: orderIdRaw,
        orderNumber: order.orderNumber != null ? String(order.orderNumber) : null,
        flow: 'bookVariant',
      };
    } else {
      if (!textbookParam) {
        return NextResponse.json(
          {
            error:
              '교재(textbook) 또는 주문(orderId)을 지정해 주세요.',
          },
          { status: 400 }
        );
      }
      textbook = textbookParam;
      passageDocs = (await passagesCol
        .find({ textbook })
        .project({ _id: 1, textbook: 1, chapter: 1, number: 1, source_key: 1 })
        .toArray()) as PDoc[];
      typesToCheck = [...BOOK_VARIANT_QUESTION_TYPES];
      requiredPerType = requiredPerTypeDefault;
    }

    if (passageDocs.length === 0) {
      return NextResponse.json({
        ok: true,
        scope,
        textbook,
        requiredPerType,
        typesChecked: typesToCheck,
        passageCount: 0,
        standardTypes: [...BOOK_VARIANT_QUESTION_TYPES],
        noQuestions: [],
        underfilled: [],
        noQuestionsTotal: 0,
        underfilledTotal: 0,
        noQuestionsTruncated: false,
        underfilledTruncated: false,
        order: orderInfo,
        orderLessonsRequested: scope === 'order' ? orderLessonsRequested : undefined,
        orderLessonsMatched: scope === 'order' ? 0 : undefined,
        lessonsWithoutPassage: scope === 'order' ? lessonsWithoutPassage : undefined,
        message:
          scope === 'order'
            ? lessonsWithoutPassage.length > 0
              ? '선택한 일부 지문 라벨에 해당하는 passages가 DB에 없습니다.'
              : '해당 조건의 원문(passages)이 없습니다.'
            : '해당 교재의 원문(passages)이 없습니다.',
      });
    }

    const ids = passageDocs.map((p) => p._id as ObjectId);
    const countMap = await aggregateCountsByPassageAndType(gqCol, ids);

    const { noQuestionsFull, underfilledFull } = buildQuestionCountReport(
      passageDocs,
      countMap,
      typesToCheck,
      requiredPerType,
      textbook
    );

    const noQuestionsTruncated = noQuestionsFull.length > MAX_LIST_ROWS;
    const underfilledTruncated = underfilledFull.length > MAX_LIST_ROWS;

    return NextResponse.json({
      ok: true,
      scope,
      textbook,
      requiredPerType,
      typesChecked: typesToCheck,
      passageCount: passageDocs.length,
      standardTypes: [...BOOK_VARIANT_QUESTION_TYPES],
      noQuestionsTotal: noQuestionsFull.length,
      underfilledTotal: underfilledFull.length,
      noQuestionsTruncated,
      underfilledTruncated,
      noQuestions: noQuestionsFull.slice(0, MAX_LIST_ROWS),
      underfilled: underfilledFull.slice(0, MAX_LIST_ROWS),
      order: orderInfo,
      orderLessonsRequested: scope === 'order' ? orderLessonsRequested : undefined,
      orderLessonsMatched: scope === 'order' ? passageDocs.length : undefined,
      lessonsWithoutPassage: scope === 'order' && lessonsWithoutPassage.length > 0 ? lessonsWithoutPassage : undefined,
    });
  } catch (e) {
    console.error('question-counts validate:', e);
    return NextResponse.json({ error: '검증 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
