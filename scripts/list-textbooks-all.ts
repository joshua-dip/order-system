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
  const textbooks = await db.collection('passages').distinct('textbook');
  const keyword = process.argv[2] ?? '';
  const filtered = keyword ? textbooks.filter((t: string) => t.includes(keyword)) : textbooks;
  filtered.sort();
  console.log(filtered.join('\n'));
}
main().catch(e => { console.error(e); process.exit(1); });
