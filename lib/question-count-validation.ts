import { ObjectId, type Collection, type Document, type Db } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import {
  BOOK_VARIANT_QUESTION_TYPES,
  DEFAULT_QUESTIONS_PER_VARIANT_TYPE,
} from '@/lib/book-variant-types';
import {
  buildQuestionCountReport,
  type NoQuestionRow,
  type UnderfilledRow,
  type UnderfilledStatusBreakdown,
} from '@/lib/question-count-report';
import { passagesForMockVariantOrder } from '@/lib/mock-variant-order';
import { GENERATED_WORKBOOKS_COLLECTION } from '@/lib/generated-workbooks-types';

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
export type QuestionStatusScope = 'all' | '대기' | '완료' | '검수불일치';

export function parseQuestionStatusScope(raw: string | null | undefined): QuestionStatusScope {
  const t = (raw ?? '').trim();
  if (t === '대기') return '대기';
  if (t === '완료') return '완료';
  if (t === '검수불일치') return '검수불일치';
  return 'all';
}

/**
 * 문제수 검증 집계·대기 건수: `option_type`이 English인 문항만 포함.
 * (필드 없음·null·빈 문자열은 English로 간주 — 레거시 호환.)
 */
export function matchGeneratedQuestionOptionTypeEnglish(): Document {
  return {
    $or: [
      { option_type: 'English' },
      { option_type: { $exists: false } },
      { option_type: null },
      { option_type: '' },
    ],
  };
}

/** API/스냅샷 공통 — 목록은 전체 행 포함(화면은 잘라서 표시) */
export type QuestionCountValidationPayload = {
  ok: true;
  scope: 'textbook' | 'order';
  textbook: string;
  /** 변형문 집계 시 status 필터 (전체 / 대기 / 완료 / 검수불일치) */
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
  /**
   * 검증 범위 지문에 연결된 변형문 중 status=대기 이고 option_type=English(또는 미설정) 건수.
   * 검수·풀이 후 `variant_review_pending_record`(정답 일치 시 완료) 대상.
   */
  pendingReviewTotal: number;
  /** 유형 미충족 행 shortBy 합 — 추가로 만들어야 하는 문항 수 */
  needCreateShortBySum: number;
  /** 변형 0건 지문마다 (typesChecked.length × requiredPerType) 슬롯 합 */
  needCreateFromEmptyPassagesTotal: number;
  /** 신규 작성 필요 문항 수 추정(위 둘의 합). 대기 검수와 별개 */
  needCreateGrandTotal: number;
  /** @deprecated pendingReviewTotal 과 동일. 기존 클라이언트 호환 */
  pendingInScopeTotal?: number;
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
  questionStatus: QuestionStatusScope,
  db?: Db,
) {
  if (ids.length === 0) {
    return new Map<string, Map<string, number>>();
  }
  const idStrings = ids.map((id) => id.toString());
  const passageIdMatch: Document = {
    $or: [{ passage_id: { $in: ids } }, { passage_id: { $in: idStrings } }],
  };
  const passageMatch: Document = {
    $and: [passageIdMatch, matchGeneratedQuestionOptionTypeEnglish()],
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
          effectiveType: {
            $cond: {
              if: {
                $and: [
                  { $eq: ['$type', '삽입'] },
                  { $eq: ['$difficulty', '상'] },
                ],
              },
              then: '삽입-고난도',
              else: '$type',
            },
          },
        },
      },
      {
        $group: {
          _id: { pid: '$pidStr', typ: '$effectiveType' },
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

  // dual-read: generated_workbooks 에서 워크북어법 카운트 병합
  if (db) {
    try {
      const wbStatusMatch: Document =
        questionStatus === 'all'
          ? {}
          : questionStatus === '완료'
            ? { status: 'reviewed' }
            : questionStatus === '대기'
              ? { status: 'draft' }
              : {};
      const wbAgg = await db
        .collection(GENERATED_WORKBOOKS_COLLECTION)
        .aggregate([
          {
            $match: {
              passage_id: { $in: ids },
              deleted_at: null,
              ...wbStatusMatch,
            },
          },
          {
            $group: {
              _id: { $toString: '$passage_id' },
              c: { $sum: 1 },
            },
          },
        ])
        .toArray();
      for (const row of wbAgg) {
        const pid = String(row._id ?? '');
        const c = Number(row.c) || 0;
        if (!countMap.has(pid)) countMap.set(pid, new Map());
        const m = countMap.get(pid)!;
        m.set('워크북어법', (m.get('워크북어법') ?? 0) + c);
      }
    } catch {
      // generated_workbooks 가 아직 없는 환경에서는 무시
    }
  }

  return countMap;
}

async function aggregatePassageAnyDocCount(
  gqCol: Collection<Document>,
  ids: ObjectId[],
  db?: Db,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (ids.length === 0) return out;
  const idStrings = ids.map((id) => id.toString());
  const agg = await gqCol
    .aggregate([
      {
        $match: {
          $or: [{ passage_id: { $in: ids } }, { passage_id: { $in: idStrings } }],
        },
      },
      {
        $group: {
          _id: { $toString: '$passage_id' },
          c: { $sum: 1 },
        },
      },
    ])
    .toArray();
  for (const row of agg) {
    out.set(String(row._id ?? ''), Number(row.c) || 0);
  }

  // dual-read: generated_workbooks 카운트 병합
  if (db) {
    try {
      const wbAgg = await db
        .collection(GENERATED_WORKBOOKS_COLLECTION)
        .aggregate([
          { $match: { passage_id: { $in: ids }, deleted_at: null } },
          { $group: { _id: { $toString: '$passage_id' }, c: { $sum: 1 } } },
        ])
        .toArray();
      for (const row of wbAgg) {
        const pid = String(row._id ?? '');
        out.set(pid, (out.get(pid) ?? 0) + (Number(row.c) || 0));
      }
    } catch {
      // generated_workbooks 미존재 환경에서 무시
    }
  }

  return out;
}

async function aggregateStatusBreakdownByPassageAndType(
  gqCol: Collection<Document>,
  ids: ObjectId[]
): Promise<Map<string, Map<string, UnderfilledStatusBreakdown>>> {
  const out = new Map<string, Map<string, UnderfilledStatusBreakdown>>();
  if (ids.length === 0) return out;
  const idStrings = ids.map((id) => id.toString());
  const passageMatch: Document = {
    $and: [
      { $or: [{ passage_id: { $in: ids } }, { passage_id: { $in: idStrings } }] },
      matchGeneratedQuestionOptionTypeEnglish(),
    ],
  };
  const agg = await gqCol
    .aggregate([
      { $match: passageMatch },
      {
        $addFields: {
          pidStr: { $toString: '$passage_id' },
          effectiveType: {
            $cond: {
              if: {
                $and: [
                  { $eq: ['$type', '삽입'] },
                  { $eq: ['$difficulty', '상'] },
                ],
              },
              then: '삽입-고난도',
              else: '$type',
            },
          },
        },
      },
      {
        $group: {
          _id: { pid: '$pidStr', typ: '$effectiveType', st: '$status' },
          c: { $sum: 1 },
        },
      },
    ])
    .toArray();

  for (const row of agg) {
    const idObj = row._id as { pid?: unknown; typ?: unknown; st?: unknown };
    const pid = String(idObj.pid ?? '');
    const typ = String(idObj.typ ?? '');
    const st = String(idObj.st ?? '');
    const c = Number(row.c) || 0;
    if (!out.has(pid)) out.set(pid, new Map());
    const m = out.get(pid)!;
    if (!m.has(typ)) m.set(typ, { 완료: 0, 대기: 0, 검수불일치: 0, 기타: 0 });
    const b = m.get(typ)!;
    if (st === '완료') b.완료 += c;
    else if (st === '대기') b.대기 += c;
    else if (st === '검수불일치') b.검수불일치 += c;
    else b.기타 += c;
  }
  return out;
}

export type RunQuestionCountValidationInput = {
  textbookParam: string;
  orderIdRaw: string;
  /** orders.orderNumber (예: BV-20260331-002). orderIdRaw와 동시 지정 불가. */
  orderNumberRaw?: string | null;
  requiredPerTypeRaw?: string | null;
  /** 쿼리/바디: questionStatus = all | 대기 | 완료 | 검수불일치 */
  questionStatusRaw?: string | null;
};

/**
 * passages(원문) 기준 변형문 집계 (교재 전체 또는 bookVariant / mockVariant 주문).
 */
export async function runQuestionCountValidation(
  input: RunQuestionCountValidationInput
): Promise<QuestionCountValidationPayload | QuestionCountValidationError> {
  const { textbookParam } = input;
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

    let orderIdTrim = input.orderIdRaw.trim();
    let orderNumberTrim = (input.orderNumberRaw ?? '').trim();
    if (orderIdTrim && orderNumberTrim) {
      return {
        ok: false,
        status: 400,
        body: { error: 'orderId와 orderNumber는 동시에 지정할 수 없습니다.' },
      };
    }

    /** 24자 hex가 아니면 ObjectId가 아님 → BV 등 주문번호가 orderId 슬롯에 온 경우로 간주 */
    if (orderIdTrim && !orderNumberTrim) {
      const isObjectIdHex24 = /^[a-fA-F0-9]{24}$/.test(orderIdTrim);
      if (!isObjectIdHex24) {
        orderNumberTrim = orderIdTrim;
        orderIdTrim = '';
      }
    }

    let orderIdResolved = orderIdTrim;
    if (orderNumberTrim) {
      const byNum = await db.collection('orders').findOne({ orderNumber: orderNumberTrim });
      if (!byNum) {
        return {
          ok: false,
          status: 404,
          body: { error: `주문번호 "${orderNumberTrim}"를 찾을 수 없습니다.` },
        };
      }
      orderIdResolved = String(byNum._id);
    }

    let textbook = '';
    let passageDocs: PDoc[] = [];
    let typesToCheck: string[] = [...BOOK_VARIANT_QUESTION_TYPES];
    let requiredPerType = requiredPerTypeDefault;
    let scope: 'textbook' | 'order' = 'textbook';
    let orderInfo: QuestionCountOrderInfo = null;
    let lessonsWithoutPassage: string[] = [];
    let orderLessonsRequested = 0;

    if (orderIdResolved) {
      if (!ObjectId.isValid(orderIdResolved)) {
        return { ok: false, status: 400, body: { error: '유효한 orderId가 아닙니다.' } };
      }
      const order = await db.collection('orders').findOne({ _id: new ObjectId(orderIdResolved) });
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

      const selectedTypesRaw = Array.isArray(m.selectedTypes)
        ? m.selectedTypes.filter((x): x is string => typeof x === 'string')
        : [];
      const qpt =
        typeof m.questionsPerType === 'number' && Number.isFinite(m.questionsPerType) && m.questionsPerType > 0
          ? Math.min(20, Math.floor(m.questionsPerType))
          : DEFAULT_QUESTIONS_PER_VARIANT_TYPE;

      if (flow === 'bookVariant') {
        textbook = typeof m.selectedTextbook === 'string' ? m.selectedTextbook.trim() : '';
        const selectedLessons = Array.isArray(m.selectedLessons)
          ? m.selectedLessons.filter((x): x is string => typeof x === 'string')
          : [];

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
          selectedTypesRaw.length > 0
            ? [...new Set(selectedTypesRaw.map((t) => t.trim()).filter(Boolean))]
            : [...BOOK_VARIANT_QUESTION_TYPES];
        requiredPerType = qpt;
        scope = 'order';
        orderInfo = {
          id: orderIdResolved,
          orderNumber: order.orderNumber != null ? String(order.orderNumber) : null,
          flow: 'bookVariant',
        };
      } else if (flow === 'mockVariant') {
        const {
          passageDocs: mockDocs,
          lessonsWithoutPassage: mockMissing,
          primaryTextbook,
          totalSlotsRequested,
        } = await passagesForMockVariantOrder(passagesCol, m.examSelections);

        if (!primaryTextbook) {
          return {
            ok: false,
            status: 400,
            body: { error: '모의고사 변형 주문에 examSelections(모의고사·번호)이 없습니다.' },
          };
        }

        textbook = primaryTextbook;
        passageDocs = mockDocs as PDoc[];
        lessonsWithoutPassage = mockMissing;
        orderLessonsRequested = totalSlotsRequested;

        typesToCheck =
          selectedTypesRaw.length > 0
            ? [...new Set(selectedTypesRaw.map((t) => t.trim()).filter(Boolean))]
            : [...BOOK_VARIANT_QUESTION_TYPES];
        requiredPerType = qpt;
        scope = 'order';
        orderInfo = {
          id: orderIdResolved,
          orderNumber: order.orderNumber != null ? String(order.orderNumber) : null,
          flow: 'mockVariant',
        };
      } else if (flow === 'unifiedVariant') {
        const dbEntriesRaw = Array.isArray(m.dbEntries) ? m.dbEntries : [];

        const allSelectedSources: string[] = [];
        for (const entry of dbEntriesRaw) {
          if (entry && typeof entry === 'object' && Array.isArray((entry as Record<string, unknown>).selectedSources)) {
            const srcs = (entry as Record<string, unknown>).selectedSources as unknown[];
            allSelectedSources.push(...srcs.filter((s): s is string => typeof s === 'string'));
          }
        }

        if (allSelectedSources.length === 0) {
          return {
            ok: false,
            status: 400,
            body: { error: '통합 주문에 선택된 지문(selectedSources)이 없습니다.' },
          };
        }

        passageDocs = (await passagesCol
          .find({ source_key: { $in: allSelectedSources } })
          .project({ _id: 1, textbook: 1, chapter: 1, number: 1, source_key: 1 })
          .toArray()) as PDoc[];

        const matchedSources = new Set(
          passageDocs.map((p) => (typeof p.source_key === 'string' ? p.source_key.trim() : ''))
        );
        lessonsWithoutPassage = allSelectedSources.filter((s) => !matchedSources.has(s));
        orderLessonsRequested = allSelectedSources.length;

        typesToCheck =
          selectedTypesRaw.length > 0
            ? [...new Set(selectedTypesRaw.map((t) => t.trim()).filter(Boolean))]
            : [...BOOK_VARIANT_QUESTION_TYPES];

        // questionsPerTypeMap 기반으로 유형별 최솟값을 공통 requiredPerType으로 사용
        const qptMap =
          typeof m.questionsPerTypeMap === 'object' && m.questionsPerTypeMap !== null && !Array.isArray(m.questionsPerTypeMap)
            ? (m.questionsPerTypeMap as Record<string, number>)
            : {};
        const perTypeValues = typesToCheck
          .map((t) => (typeof qptMap[t] === 'number' && qptMap[t] > 0 ? Math.floor(qptMap[t]) : qpt))
          .filter((v) => v > 0);
        requiredPerType = perTypeValues.length > 0 ? Math.min(...perTypeValues) : qpt;

        textbook = 'UV';
        scope = 'order';
        orderInfo = {
          id: orderIdResolved,
          orderNumber: order.orderNumber != null ? String(order.orderNumber) : null,
          flow: 'unifiedVariant',
        };
      } else {
        return {
          ok: false,
          status: 400,
          body: {
            error:
              '문제수 검증 주문 범위는 부교재 변형(bookVariant), 모의고사 변형(mockVariant), 또는 통합 변형(unifiedVariant)만 지원합니다. (워크북·번호별 제작 등은 orderMeta 구조가 다릅니다.)',
            flow: flow || null,
          },
        };
      }
    } else {
      if (!textbookParam) {
        return {
          ok: false,
          status: 400,
          body: { error: '교재(textbook) 또는 주문(orderId / orderNumber)을 지정해 주세요.' },
        };
      }
      textbook = textbookParam;

      // 기출기반 교재 여부 확인
      const examLink = await db
        .collection('textbook_links')
        .findOne({ textbookKey: textbook, isExamBased: true }, { projection: { _id: 1 } });
      const isExamBased = Boolean(examLink);

      if (isExamBased) {
        // 기출기반 교재: original_passage_id로 generated_questions 조회
        const rawDocs = await passagesCol
          .find({ textbook })
          .project({ _id: 1, textbook: 1, chapter: 1, number: 1, source_key: 1, original_passage_id: 1 })
          .toArray();

        // queryIds: original_passage_id 우선, 없으면 self
        const examToOrigMap = new Map<string, string>(); // examId hex → origId hex
        const queryIdMap = new Map<string, ObjectId>(); // hex → ObjectId (dedup)
        for (const p of rawDocs) {
          const examHex = (p._id as ObjectId).toHexString();
          if (p.original_passage_id) {
            let origId: ObjectId;
            try {
              origId = p.original_passage_id instanceof ObjectId
                ? p.original_passage_id
                : new ObjectId(String(p.original_passage_id));
            } catch { origId = p._id as ObjectId; }
            const origHex = origId.toHexString();
            examToOrigMap.set(examHex, origHex);
            queryIdMap.set(origHex, origId);
          } else {
            queryIdMap.set(examHex, p._id as ObjectId);
          }
        }
        const queryIds = [...queryIdMap.values()];

        const [rawCountMap, rawAnyCount] = await Promise.all([
          aggregateCountsByPassageAndType(gqCol, queryIds, questionStatusScope, db),
          aggregatePassageAnyDocCount(gqCol, queryIds, db),
        ]);

        // countMap/anyCount 키를 exam passage ID로 리맵
        const countMap = new Map<string, Map<string, number>>();
        const passageAnyDocCount = new Map<string, number>();
        for (const p of rawDocs) {
          const examHex = (p._id as ObjectId).toHexString();
          const lookupHex = examToOrigMap.get(examHex) ?? examHex;
          const typeCounts = rawCountMap.get(lookupHex);
          if (typeCounts) countMap.set(examHex, typeCounts);
          const anyCount = rawAnyCount.get(lookupHex) ?? 0;
          if (anyCount > 0) passageAnyDocCount.set(examHex, anyCount);
        }

        passageDocs = rawDocs as PDoc[];

        const { noQuestionsFull, underfilledFull: underfilledRaw } = buildQuestionCountReport(
          passageDocs,
          countMap,
          typesToCheck,
          requiredPerType,
          textbook,
          passageAnyDocCount
        );

        const queryIdsArr = queryIds;
        const queryIdStrings = queryIdsArr.map((id) => id.toString());
        const passagePendingMatch: Document = {
          $and: [
            { $or: [{ passage_id: { $in: queryIdsArr } }, { passage_id: { $in: queryIdStrings } }] },
            { status: '대기' },
            matchGeneratedQuestionOptionTypeEnglish(),
          ],
        };

        let underfilledFull = underfilledRaw;
        const [pendingReviewTotal, breakdownMap] = await Promise.all([
          gqCol.countDocuments(passagePendingMatch),
          questionStatusScope === 'all'
            ? aggregateStatusBreakdownByPassageAndType(gqCol, queryIdsArr)
            : Promise.resolve(null as Map<string, Map<string, UnderfilledStatusBreakdown>> | null),
        ]);

        if (questionStatusScope === 'all' && breakdownMap) {
          // breakdownMap keys are origId hex — remap to exam passage IDs for underfilled rows
          const origToExamMap = new Map<string, string>();
          for (const [examHex, origHex] of examToOrigMap) origToExamMap.set(origHex, examHex);
          underfilledFull = underfilledRaw.map((row) => {
            const lookupId = origToExamMap.get(row.passageId) ?? row.passageId;
            const b = breakdownMap.get(lookupId)?.get(row.type)
              ?? breakdownMap.get(row.passageId)?.get(row.type);
            const statusBreakdown: UnderfilledStatusBreakdown = b ?? {
              완료: 0, 대기: 0, 검수불일치: 0, 기타: row.count,
            };
            return { ...row, statusBreakdown };
          });
        }

        const needCreateShortBySum = underfilledFull.reduce((s, r) => s + r.shortBy, 0);
        const needCreateFromEmptyPassagesTotal = noQuestionsFull.length * typesToCheck.length * requiredPerType;
        const needCreateGrandTotal = needCreateShortBySum + needCreateFromEmptyPassagesTotal;

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
          noQuestionsTruncated: noQuestionsFull.length > QUESTION_COUNT_DEFAULT_LIST_ROWS,
          underfilledTruncated: underfilledFull.length > QUESTION_COUNT_DEFAULT_LIST_ROWS,
          noQuestions: noQuestionsFull,
          underfilled: underfilledFull,
          pendingReviewTotal,
          needCreateShortBySum,
          needCreateFromEmptyPassagesTotal,
          needCreateGrandTotal,
          pendingInScopeTotal: pendingReviewTotal,
          order: null,
        };
      }

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
        pendingReviewTotal: 0,
        needCreateShortBySum: 0,
        needCreateFromEmptyPassagesTotal: 0,
        needCreateGrandTotal: 0,
        pendingInScopeTotal: 0,
        order: orderInfo,
        orderLessonsRequested: scope === 'order' ? orderLessonsRequested : undefined,
        orderLessonsMatched: scope === 'order' ? 0 : undefined,
        lessonsWithoutPassage: scope === 'order' ? lessonsWithoutPassage : undefined,
        message,
      };
    }

    const ids = passageDocs.map((p) => p._id as ObjectId);
    const idStrings = ids.map((id) => id.toString());
    const [countMap, passageAnyDocCount] = await Promise.all([
      aggregateCountsByPassageAndType(gqCol, ids, questionStatusScope, db),
      aggregatePassageAnyDocCount(gqCol, ids, db),
    ]);

    const { noQuestionsFull, underfilledFull: underfilledRaw } = buildQuestionCountReport(
      passageDocs,
      countMap,
      typesToCheck,
      requiredPerType,
      textbook,
      passageAnyDocCount
    );

    const passagePendingMatch: Document = {
      $and: [
        { $or: [{ passage_id: { $in: ids } }, { passage_id: { $in: idStrings } }] },
        { status: '대기' },
        matchGeneratedQuestionOptionTypeEnglish(),
      ],
    };

    let underfilledFull = underfilledRaw;
    const [pendingReviewTotal, breakdownMap] = await Promise.all([
      gqCol.countDocuments(passagePendingMatch),
      questionStatusScope === 'all'
        ? aggregateStatusBreakdownByPassageAndType(gqCol, ids)
        : Promise.resolve(null as Map<string, Map<string, UnderfilledStatusBreakdown>> | null),
    ]);

    if (questionStatusScope === 'all' && breakdownMap) {
      underfilledFull = underfilledRaw.map((row) => {
        const b = breakdownMap.get(row.passageId)?.get(row.type);
        const statusBreakdown: UnderfilledStatusBreakdown = b ?? {
          완료: 0,
          대기: 0,
          검수불일치: 0,
          기타: row.count,
        };
        return { ...row, statusBreakdown };
      });
    }

    const needCreateShortBySum = underfilledFull.reduce((s, r) => s + r.shortBy, 0);
    const needCreateFromEmptyPassagesTotal =
      noQuestionsFull.length * typesToCheck.length * requiredPerType;
    const needCreateGrandTotal = needCreateShortBySum + needCreateFromEmptyPassagesTotal;

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
      pendingReviewTotal,
      needCreateShortBySum,
      needCreateFromEmptyPassagesTotal,
      needCreateGrandTotal,
      pendingInScopeTotal: pendingReviewTotal,
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
