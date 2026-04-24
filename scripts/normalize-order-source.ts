/**
 * 주문에 매칭된 passage들의 generated_questions source 필드를
 * passage.source_key와 동일하게 정규화.
 *
 * 사용: npx tsx scripts/normalize-order-source.ts <orderNumber>
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { passagesForMockVariantOrder } from '@/lib/mock-variant-order';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.join(PROJECT_ROOT, '.env') });
config({ path: path.join(PROJECT_ROOT, '.env.local') });

async function main() {
  const orderNumber = process.argv[2];
  if (!orderNumber) { console.error('orderNumber 필요'); process.exit(1); }
  const db = await getDb('gomijoshua');
  const order = await db.collection('orders').findOne({ orderNumber });
  if (!order) { console.error('주문 없음'); process.exit(1); }
  const passagesCol = db.collection('passages');
  const examSel = (order.orderMeta as Record<string, unknown>)?.examSelections;
  const { passageDocs } = await passagesForMockVariantOrder(passagesCol, examSel);

  const gqCol = db.collection('generated_questions');
  let totalUpdated = 0;
  let totalChecked = 0;
  let totalMatched = 0;

  for (const p of passageDocs) {
    const passageId = p._id as ObjectId;
    const canonicalSource = String(p.source_key ?? '').trim();
    const canonicalTextbook = String(p.textbook ?? '').trim();
    if (!canonicalSource || !canonicalTextbook) {
      console.log(JSON.stringify({ passageId: String(passageId), warn: 'source_key/textbook 없음' }));
      continue;
    }
    const docs = await gqCol.find({ passage_id: passageId }).toArray();
    for (const d of docs) {
      totalChecked++;
      const currentSource = String(d.source ?? '').trim();
      const currentTextbook = String(d.textbook ?? '').trim();
      const sourceOK = currentSource === canonicalSource;
      const textbookOK = currentTextbook === canonicalTextbook;
      if (sourceOK && textbookOK) { totalMatched++; continue; }
      const $set: Record<string, unknown> = { updated_at: new Date() };
      if (!sourceOK) $set.source = canonicalSource;
      if (!textbookOK) $set.textbook = canonicalTextbook;
      const r = await gqCol.updateOne({ _id: d._id }, { $set });
      if (r.modifiedCount > 0) {
        totalUpdated++;
        console.log(JSON.stringify({
          id: String(d._id),
          sourceFrom: sourceOK ? null : currentSource,
          sourceTo: sourceOK ? null : canonicalSource,
          textbookFrom: textbookOK ? null : currentTextbook,
          textbookTo: textbookOK ? null : canonicalTextbook,
        }));
      }
    }
  }
  console.log(`\n체크: ${totalChecked}, 이미 일치: ${totalMatched}, 수정: ${totalUpdated}`);
}
main().catch(e => { console.error(e); process.exit(1); });
