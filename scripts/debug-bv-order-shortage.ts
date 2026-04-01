/**
 * 주문번호(bookVariant) 기준으로 메타·passages·generated_questions 집계를 덤프 (일회 진단용).
 *   npx tsx scripts/debug-bv-order-shortage.ts BV-20260330-002
 *   npx tsx scripts/debug-bv-order-shortage.ts BV-20260330-002 "01" "05"
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { BOOK_VARIANT_QUESTION_TYPES } from '@/lib/book-variant-types';
import {
  runQuestionCountValidation,
  sliceQuestionCountPayloadForApi,
} from '@/lib/question-count-validation';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.join(PROJECT_ROOT, '.env') });
config({ path: path.join(PROJECT_ROOT, '.env.local') });

async function main() {
  const orderNumber = process.argv[2]?.trim();
  if (!orderNumber) {
    console.error('사용법: npx tsx scripts/debug-bv-order-shortage.ts <주문번호> [chapter필터] [number필터]');
    process.exit(1);
  }
  const chFilter = process.argv[3]?.trim();
  const numFilter = process.argv[4]?.trim();

  const db = await getDb('gomijoshua');
  const order = await db.collection('orders').findOne({ orderNumber });
  if (!order) {
    console.log(JSON.stringify({ error: '주문 없음', orderNumber }, null, 2));
    process.exit(1);
  }

  const meta = order.orderMeta as Record<string, unknown> | null | undefined;
  const m = meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {};
  const textbook = typeof m.selectedTextbook === 'string' ? m.selectedTextbook.trim() : '';
  const selectedLessons = Array.isArray(m.selectedLessons)
    ? m.selectedLessons.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean)
    : [];
  const selectedTypes = Array.isArray(m.selectedTypes)
    ? m.selectedTypes.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean)
    : [];
  const qpt =
    typeof m.questionsPerType === 'number' && Number.isFinite(m.questionsPerType) && m.questionsPerType > 0
      ? m.questionsPerType
      : null;
  const flow = typeof m.flow === 'string' ? m.flow : '';

  const normalizedLessons = [...new Set(selectedLessons)];
  const passagesCol = db.collection('passages');
  const gqCol = db.collection('generated_questions');

  const passageDocs = await passagesCol
    .find({ textbook, source_key: { $in: normalizedLessons } })
    .project({ _id: 1, source_key: 1, chapter: 1, number: 1 })
    .toArray();

  const matchedKeys = new Set(passageDocs.map((p) => String(p.source_key ?? '').trim()));
  const lessonsWithoutPassage = normalizedLessons.filter((l) => !matchedKeys.has(l));

  const validation = await runQuestionCountValidation({
    textbookParam: '',
    orderIdRaw: '',
    orderNumberRaw: orderNumber,
    questionStatusRaw: 'all',
  });

  const sliced =
    validation.ok === true ? sliceQuestionCountPayloadForApi(validation, 500) : null;

  let focusPassages = passageDocs;
  if (chFilter || numFilter) {
    focusPassages = passageDocs.filter((p) => {
      const ch = String(p.chapter ?? '');
      const num = String(p.number ?? '');
      if (chFilter && !ch.includes(chFilter)) return false;
      if (numFilter && !num.includes(numFilter)) return false;
      return true;
    });
  }

  const focusDetail = await Promise.all(
    focusPassages.map(async (p) => {
      const pid = p._id as ObjectId;
      const pidStr = pid.toString();
      const gq = await gqCol
        .find({
          $or: [{ passage_id: pid }, { passage_id: pidStr }],
          textbook,
        })
        .project({ type: 1, status: 1, source: 1 })
        .toArray();
      const typesChecked =
        selectedTypes.length > 0 ? selectedTypes : [...BOOK_VARIANT_QUESTION_TYPES];
      const byType: Record<
        string,
        { total: number; 완료: number; 대기: number; 검수불일치: number; 기타: number }
      > = {};
      for (const t of typesChecked) {
        byType[t] = { total: 0, 완료: 0, 대기: 0, 검수불일치: 0, 기타: 0 };
      }
      for (const row of gq) {
        const typ = String(row.type ?? '').trim();
        if (!byType[typ])
          byType[typ] = { total: 0, 완료: 0, 대기: 0, 검수불일치: 0, 기타: 0 };
        byType[typ].total++;
        const st = String(row.status ?? '');
        if (st === '완료') byType[typ].완료++;
        else if (st === '대기') byType[typ].대기++;
        else if (st === '검수불일치') byType[typ].검수불일치++;
        else byType[typ].기타++;
      }
      const required = qpt ?? 3;
      const short: { type: string; have: number; need: number; shortBy: number }[] = [];
      for (const typ of typesChecked) {
        const have = byType[typ]?.total ?? 0;
        if (have < required) short.push({ type: typ, have, need: required, shortBy: required - have });
      }
      return {
        passage_id: pidStr,
        source_key: p.source_key,
        chapter: p.chapter,
        number: p.number,
        generatedQuestionCount: gq.length,
        byType,
        shortByOurRule: short,
      };
    })
  );

  const out = {
    orderNumber,
    orderId: String(order._id),
    flow,
    textbook,
    selectedLessons: normalizedLessons,
    selectedLessonsCount: normalizedLessons.length,
    selectedTypes: selectedTypes.length > 0 ? selectedTypes : '(비어 있음 → 표준 11유형 전부)',
    questionsPerType: qpt ?? `(미설정 → 기본 ${3})`,
    passagesMatched: passageDocs.length,
    lessonsWithoutPassage,
    validationOk: validation.ok,
    validationSummary:
      validation.ok === true
        ? {
            noQuestionsTotal: validation.noQuestionsTotal,
            underfilledTotal: validation.underfilledTotal,
            pendingReviewTotal: validation.pendingReviewTotal,
            needCreateShortBySum: validation.needCreateShortBySum,
            needCreateFromEmptyPassagesTotal: validation.needCreateFromEmptyPassagesTotal,
            needCreateGrandTotal: validation.needCreateGrandTotal,
            typesChecked: validation.typesChecked,
            requiredPerType: validation.requiredPerType,
          }
        : validation,
    firstUnderfilled: sliced?.underfilled?.slice(0, 15),
    focusPassagesDetail: focusDetail,
  };

  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
