import { ObjectId, type Collection, type Document } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import {
  BOOK_VARIANT_QUESTION_TYPES,
  DEFAULT_QUESTIONS_PER_VARIANT_TYPE,
} from '@/lib/book-variant-types';
import { buildQuestionCountReport, type NoQuestionRow, type UnderfilledRow } from '@/lib/question-count-report';

/** 목록 API/화면에 기본으로 내려주는 최대 행 수 */
export const QUESTION_COUNT_DEFAULT_LIST_ROWS = 12_000;
/** maxListRows 파라미터 상한 */
export const QUESTION_COUNT_LIST_CAP = 35_000;
/** @deprecated QUESTION_COUNT_DEFAULT_LIST_ROWS 사용 */
export const QUESTION_COUNT_MAX_LIST_ROWS = QUESTION_COUNT_DEFAULT_LIST_ROWS;

type PDoc = {
  _id: ObjectId;
  textbook?: unknown;
  chapter?: unknown;
  number?: unknown;
  source_key?: unknown;
};

export type QuestionCountOrderInfo = {
  id: string;
  orderNumber: string | null;
  flow: string;
} | null;

/** generated_questions.status 기준 집계 범위 (미지정·잘못된 값은 전체) */
export type QuestionStatusScope = 'all' | '대기' | '완료';

export function parseQuestionStatusScope(raw: string | null | undefined): QuestionStatusScope {
  const t = (raw ?? '').trim();
  if (t === '대기') return '대기';
  if (t === '완료') return '완료';
  return 'all';
}

/** API/스냅샷 공통 — 목록은 전체 행 포함(화면은 잘라서 표시) */
export type QuestionCountValidationPayload = {
  ok: true;
  scope: 'textbook' | 'order';
  textbook: string;
  /** 변형문 집계 시 status 필터 (전체 / 대기 / 완료) */
  questionStatusScope: QuestionStatusScope;
  requiredPerType: number;
  typesChecked: string[];
  passageCount: number;
  standardTypes: string[];
  noQuestionsTotal: number;
  underfilledTotal: number;
  noQuestionsTruncated: boolean;
  underfilledTruncated: boolean;
  noQuestions: NoQuestionRow[];
  underfilled: UnderfilledRow[];
  order: QuestionCountOrderInfo;
  orderLessonsRequested?: number;
  orderLessonsMatched?: number;
  lessonsWithoutPassage?: string[];
  message?: string;
};

export type QuestionCountValidationError = {
  ok: false;
  status: number;
  body: Record<string, unknown>;
};

async function aggregateCountsByPassageAndType(
  gqCol: Collection<Document>,
  ids: ObjectId[],
  questionStatus: QuestionStatusScope
) {
  if (ids.length === 0) {
    return new Map<string, Map<string, number>>();
  }
  const idStrings = ids.map((id) => id.toString());
  const passageMatch: Document = {
    $or: [{ passage_id: { $in: ids } }, { passage_id: { $in: idStrings } }],
  };
  const match: Document =
    questionStatus === 'all'
      ? passageMatch
      : { $and: [passageMatch, { status: questionStatus }] };
  const agg = await gqCol
    .aggregate([
      {
        $match: match,
      },
      {
        $addFields: {
          pidStr: { $toString: '$passage_id' },
        },
      },
      {
        $group: {
          _id: { pid: '$pidStr', typ: '$type' },
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

export type RunQuestionCountValidationInput = {
  textbookParam: string;
  orderIdRaw: string;
  requiredPerTypeRaw?: string | null;
  /** 쿼리/바디: questionStatus = all | 대기 | 완료 */
  questionStatusRaw?: string | null;
};

/**
 * passages(원문) 기준 변형문 집계 (교재 전체 또는 bookVariant 주문).
 */
export async function runQuestionCountValidation(
  input: RunQuestionCountValidationInput
): Promise<QuestionCountValidationPayload | QuestionCountValidationError> {
  const { textbookParam, orderIdRaw } = input;
  const questionStatusScope = parseQuestionStatusScope(input.questionStatusRaw);
  const requiredPerTypeDefault = Math.max(
    1,
    Math.min(
      20,
      parseInt(input.requiredPerTypeRaw || String(DEFAULT_QUESTIONS_PER_VARIANT_TYPE), 10) ||
        DEFAULT_QUESTIONS_PER_VARIANT_TYPE
    )
  );

  try {
    const db = await getDb('gomijoshua');
    const passagesCol = db.collection('passages');
    const gqCol = db.collection('generated_questions');

    let textbook = '';
    let passageDocs: PDoc[] = [];
    let typesToCheck: string[] = [...BOOK_VARIANT_QUESTION_TYPES];
    let requiredPerType = requiredPerTypeDefault;
    let scope: 'textbook' | 'order' = 'textbook';
    let orderInfo: QuestionCountOrderInfo = null;
    let lessonsWithoutPassage: string[] = [];
    let orderLessonsRequested = 0;

    if (orderIdRaw) {
      if (!ObjectId.isValid(orderIdRaw)) {
        return { ok: false, status: 400, body: { error: '유효한 orderId가 아닙니다.' } };
      }
      const order = await db.collection('orders').findOne({ _id: new ObjectId(orderIdRaw) });
      if (!order) {
        return { ok: false, status: 404, body: { error: '주문을 찾을 수 없습니다.' } };
      }
      const meta = order.orderMeta;
      if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
        return {
          ok: false,
          status: 400,
          body: { error: '이 주문에는 orderMeta가 없어 지문 목록을 알 수 없습니다.' },
        };
      }
      const m = meta as Record<string, unknown>;
      const flow = typeof m.flow === 'string' ? m.flow : '';
      if (flow !== 'bookVariant') {
        return {
          ok: false,
          status: 400,
          body: {
            error:
              '부교재 변형(bookVariant) 주문만 지원합니다. (모의고사·워크북 주문은 orderMeta 구조가 달라 추후 확장 가능)',
            flow: flow || null,
          },
        };
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
        return {
          ok: false,
          status: 400,
          body: { error: '주문 메타에 교재명(selectedTextbook)이 없습니다.' },
        };
      }
      if (selectedLessons.length === 0) {
        return { ok: false, status: 400, body: { error: '주문에 선택된 지문(selectedLessons)이 없습니다.' } };
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
        return {
          ok: false,
          status: 400,
          body: { error: '교재(textbook) 또는 주문(orderId)을 지정해 주세요.' },
        };
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
      const message =
        scope === 'order'
          ? lessonsWithoutPassage.length > 0
            ? '선택한 일부 지문 라벨에 해당하는 passages가 DB에 없습니다.'
            : '해당 조건의 원문(passages)이 없습니다.'
          : '해당 교재의 원문(passages)이 없습니다.';
      return {
        ok: true,
        scope,
        textbook,
        questionStatusScope,
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
        message,
      };
    }

    const ids = passageDocs.map((p) => p._id as ObjectId);
    const countMap = await aggregateCountsByPassageAndType(gqCol, ids, questionStatusScope);

    const { noQuestionsFull, underfilledFull } = buildQuestionCountReport(
      passageDocs,
      countMap,
      typesToCheck,
      requiredPerType,
      textbook
    );

    const noQuestionsTruncated = noQuestionsFull.length > QUESTION_COUNT_DEFAULT_LIST_ROWS;
    const underfilledTruncated = underfilledFull.length > QUESTION_COUNT_DEFAULT_LIST_ROWS;

    return {
      ok: true,
      scope,
      textbook,
      questionStatusScope,
      requiredPerType,
      typesChecked: typesToCheck,
      passageCount: passageDocs.length,
      standardTypes: [...BOOK_VARIANT_QUESTION_TYPES],
      noQuestionsTotal: noQuestionsFull.length,
      underfilledTotal: underfilledFull.length,
      noQuestionsTruncated,
      underfilledTruncated,
      noQuestions: noQuestionsFull,
      underfilled: underfilledFull,
      order: orderInfo,
      orderLessonsRequested: scope === 'order' ? orderLessonsRequested : undefined,
      orderLessonsMatched: scope === 'order' ? passageDocs.length : undefined,
      lessonsWithoutPassage: scope === 'order' && lessonsWithoutPassage.length > 0 ? lessonsWithoutPassage : undefined,
    };
  } catch (e) {
    console.error('runQuestionCountValidation:', e);
    return { ok: false, status: 500, body: { error: '검증 중 오류가 발생했습니다.' } };
  }
}

/** 화면/API용으로 행 수 제한 (`maxRows` 기본 QUESTION_COUNT_DEFAULT_LIST_ROWS, 상한 QUESTION_COUNT_LIST_CAP) */
export function sliceQuestionCountPayloadForApi(
  data: QuestionCountValidationPayload,
  maxRows?: number
): QuestionCountValidationPayload {
  const raw = maxRows ?? QUESTION_COUNT_DEFAULT_LIST_ROWS;
  const cap = Math.min(
    QUESTION_COUNT_LIST_CAP,
    Math.max(400, Math.floor(raw)) || QUESTION_COUNT_DEFAULT_LIST_ROWS
  );
  return {
    ...data,
    noQuestionsTruncated: data.noQuestions.length > cap,
    underfilledTruncated: data.underfilled.length > cap,
    noQuestions: data.noQuestions.slice(0, cap),
    underfilled: data.underfilled.slice(0, cap),
  };
}
