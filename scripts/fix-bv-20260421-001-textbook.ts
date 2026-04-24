/** BV-20260421-001의 orderMeta.selectedTextbook: (2024) → (2026) */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { getDb } from '@/lib/mongodb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.join(PROJECT_ROOT, '.env') });
config({ path: path.join(PROJECT_ROOT, '.env.local') });

async function main() {
  const db = await getDb('gomijoshua');
  const col = db.collection('orders');
  const orderNumber = 'BV-20260421-001';
  const before = await col.findOne({ orderNumber });
  if (!before) { console.error('주문 없음'); process.exit(1); }
  const meta = (before.orderMeta ?? {}) as Record<string, unknown>;
  const current = String(meta.selectedTextbook ?? '');
  console.log(JSON.stringify({ before: current }));
  const target = '지금필수 고난도유형(2026)';
  if (current === target) { console.log('이미 일치'); return; }
  const r = await col.updateOne(
    { orderNumber },
    { $set: { 'orderMeta.selectedTextbook': target, updated_at: new Date() } }
  );
  console.log(JSON.stringify({ matched: r.matchedCount, modified: r.modifiedCount, after: target }));
}
main().catch(e => { console.error(e); process.exit(1); });
