/**
 * generated_questions 컬렉션에서 type='불일치' 인 문항 중 question_data.Options 가
 * 한글 선택지를 포함하는 문항 목록을 출력.
 *
 * 사용: npx tsx scripts/scan-disagreement-korean-options.ts
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { getDb } from '@/lib/mongodb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.join(PROJECT_ROOT, '.env') });
config({ path: path.join(PROJECT_ROOT, '.env.local') });

const HANGUL_RE = /[가-힣]/; // any Korean syllable

async function main() {
  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');

  const cursor = col.find({ type: '불일치' }).project({
    _id: 1, textbook: 1, source: 1, status: 1, 'question_data.Options': 1,
  });

  let total = 0;
  let withKorean = 0;
  const byTextbook = new Map<string, { id: string; source: string; status: string }[]>();

  for await (const d of cursor) {
    total++;
    const opts = (d.question_data as Record<string, unknown> | undefined)?.Options;
    const optsStr = typeof opts === 'string' ? opts : Array.isArray(opts) ? (opts as unknown[]).join('\n') : '';
    if (HANGUL_RE.test(optsStr)) {
      withKorean++;
      const tb = String(d.textbook ?? '');
      if (!byTextbook.has(tb)) byTextbook.set(tb, []);
      byTextbook.get(tb)!.push({
        id: String(d._id),
        source: String(d.source ?? ''),
        status: String(d.status ?? ''),
      });
    }
  }

  console.log(`Total 불일치 questions: ${total}`);
  console.log(`With Korean options:    ${withKorean}\n`);

  for (const [tb, items] of [...byTextbook.entries()].sort()) {
    console.log(`### ${tb}  (${items.length})`);
    for (const it of items.sort((a, b) => a.source.localeCompare(b.source))) {
      console.log(`  ${it.id}  ${it.source}  [${it.status}]`);
    }
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
