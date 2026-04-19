/**
 * 주문에 매칭된 모든 passage의 generated_questions를 type별로 집계.
 * 사용: npx tsx scripts/list-order-questions.ts <orderNumber>
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { getDb } from '@/lib/mongodb';
import { passagesForMockVariantOrder } from '@/lib/mock-variant-order';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.join(PROJECT_ROOT, '.env') });
config({ path: path.join(PROJECT_ROOT, '.env.local') });

async function main() {
  const orderNumber = process.argv[2];
  const db = await getDb('gomijoshua');
  const order = await db.collection('orders').findOne({ orderNumber });
  if (!order) { console.error('없음'); process.exit(1); }
  const passagesCol = db.collection('passages');
  const examSel = (order.orderMeta as Record<string, unknown>)?.examSelections;
  const { passageDocs, lessonsWithoutPassage, totalSlotsRequested } =
    await passagesForMockVariantOrder(passagesCol, examSel);
  console.log(`slots=${totalSlotsRequested} matched=${passageDocs.length} missing=${lessonsWithoutPassage.length}`);
  if (lessonsWithoutPassage.length > 0) {
    for (const l of lessonsWithoutPassage) console.log('[miss]', l);
  }
  const passageIds = passageDocs.map((p) => p._id);
  const gqCol = db.collection('generated_questions');
  const docs = await gqCol.find({ passage_id: { $in: passageIds } }).sort({ source: 1, type: 1 }).toArray();
  console.log(`questions=${docs.length}`);
  for (const d of docs) {
    console.log(JSON.stringify({ id: String(d._id), passage_id: String(d.passage_id), source: d.source, type: d.type, status: d.status }));
  }
}
main().catch(e => { console.error(e); process.exit(1); });
