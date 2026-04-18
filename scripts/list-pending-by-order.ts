/**
 * 일회성: 특정 주문(orderNumber)에 속한 변형문 중 status=대기 목록을 정답 없이 출력.
 * 사용:  npx tsx scripts/list-pending-by-order.ts MV-20260417-001 [limit]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
config({ path: path.join(PROJECT_ROOT, '.env') });
config({ path: path.join(PROJECT_ROOT, '.env.local') });

import { ObjectId, type Document } from 'mongodb';
import { getDb } from '../lib/mongodb';
import { passagesForMockVariantOrder } from '../lib/mock-variant-order';
import { matchGeneratedQuestionOptionTypeEnglish, runQuestionCountValidation } from '../lib/question-count-validation';
import { getQuestionDataForReview } from '../lib/generated-question-review-cc';

async function main() {
  const orderNumber = (process.argv[2] || '').trim();
  const limit = Math.min(50, Math.max(1, Number(process.argv[3] || '50')));
  if (!orderNumber) {
    console.error('orderNumber 인자가 필요합니다 (예: MV-20260417-001)');
    process.exit(2);
  }

  const db = await getDb('gomijoshua');
  const order = await db.collection('orders').findOne({ orderNumber });
  if (!order) {
    console.error('주문을 찾을 수 없습니다:', orderNumber);
    process.exit(2);
  }

  const meta = (order.orderMeta ?? {}) as Record<string, unknown>;
  const flow = String(meta.flow ?? '');
  if (flow !== 'mockVariant') {
    console.error('이 스크립트는 mockVariant 전용입니다. flow=', flow);
    process.exit(2);
  }

  const passagesCol = db.collection('passages');
  const { passageDocs } = await passagesForMockVariantOrder(
    passagesCol,
    (meta as { examSelections?: unknown }).examSelections
  );

  const ids = passageDocs.map((p) => p._id as ObjectId);
  const idStrings = ids.map((id) => id.toString());
  if (process.env.DEBUG) {
    console.error('passageCount=', ids.length);
    console.error('passages=', passageDocs.map((p) => ({ id: String(p._id), textbook: p.textbook, number: p.number })));
  }

  const gqCol = db.collection('generated_questions');
  const filter: Document = {
    $and: [
      { $or: [{ passage_id: { $in: ids } }, { passage_id: { $in: idStrings } }] },
      { status: '대기' },
      matchGeneratedQuestionOptionTypeEnglish(),
    ],
  };

  if (process.env.DEBUG) {
    const validation = await runQuestionCountValidation({
      textbookParam: '',
      orderIdRaw: '',
      orderNumberRaw: orderNumber,
      requiredPerTypeRaw: '3',
      questionStatusRaw: null,
    });
    if (validation.ok) {
      console.error('validation.pendingReviewTotal=', (validation as any).pendingReviewTotal);
      console.error('validation.passageCount=', (validation as any).passageCount);
    } else {
      console.error('validation FAILED:', validation.body);
    }
    const c1 = await gqCol.countDocuments({ $or: [{ passage_id: { $in: ids } }, { passage_id: { $in: idStrings } }] });
    const c2 = await gqCol.countDocuments({ $or: [{ passage_id: { $in: ids } }, { passage_id: { $in: idStrings } }], status: '대기' });
    const c3 = await gqCol.countDocuments({ $or: [{ passage_id: { $in: ids } }, { passage_id: { $in: idStrings } }], status: '대기', ...matchGeneratedQuestionOptionTypeEnglish() });
    console.error('counts: anyByPassage=', c1, 'pending=', c2, 'pendingEnglish=', c3);
    const allStatuses = await gqCol.aggregate([
      { $match: { $or: [{ passage_id: { $in: ids } }, { passage_id: { $in: idStrings } }] } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]).toArray();
    console.error('statuses=', allStatuses);
    const totalPendingAnywhere = await gqCol.countDocuments({ status: '대기' });
    console.error('totalPendingInAllDB=', totalPendingAnywhere);
  }
  const total = await gqCol.countDocuments(filter);
  const docs = await gqCol.find(filter).sort({ created_at: 1 }).limit(limit).toArray();

  const items = docs.map((doc) => {
    const id = doc._id as ObjectId;
    const { question, paragraph, options } = getQuestionDataForReview(doc.question_data);
    return {
      generated_question_id: id.toString(),
      textbook: String(doc.textbook ?? ''),
      source: String(doc.source ?? ''),
      type: String(doc.type ?? '').trim(),
      status: String(doc.status ?? ''),
      question,
      paragraph,
      options,
    };
  });

  console.log(JSON.stringify({ ok: true, orderNumber, total, returned: items.length, items }, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
