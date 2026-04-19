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
  const orderNumber = process.argv[2];
  const db = await getDb('gomijoshua');
  const order = await db.collection('orders').findOne({ orderNumber });
  if (!order) { console.error('없음'); process.exit(1); }
  const keys = Object.keys(order);
  console.log('top-level keys:', keys);
  console.log('orderMeta keys:', order.orderMeta ? Object.keys(order.orderMeta) : null);
  console.log(JSON.stringify(order, null, 2));
}
main().catch(e => { console.error(e); process.exit(1); });
