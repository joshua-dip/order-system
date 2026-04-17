/**
 * Claude API 없이 `buildBulkVariantExplanation`로 해설이 비어 있는 변형문을 일괄 보강한다.
 *
 *   npx tsx scripts/fill-bulk-explanations-noapi.ts [--textbook "얇고 빠른 미니 모의고사 입문"] [--dry-run true]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { buildBulkVariantExplanation } from '@/lib/generated-question-explanation-bulk';
import { isGeneratedQuestionExplanationEmpty } from '@/lib/generated-question-explanation-fallback';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.join(root, '.env') });
config({ path: path.join(root, '.env.local') });

function parseFlags(argv: string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        flags.set(key, next);
        i++;
      } else {
        flags.set(key, 'true');
      }
    }
  }
  return flags;
}

function pickParagraph(qd: Record<string, unknown>): string {
  const v = qd.Paragraph ?? qd.paragraph;
  if (typeof v !== 'string') return '';
  return v.trim();
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const textbook = (flags.get('textbook') ?? '얇고 빠른 미니 모의고사 입문').trim();
  const dryRun = flags.get('dry-run') === 'true';

  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');

  let scanned = 0;
  let eligible = 0;
  let updated = 0;
  const cursor = col.find({ textbook }).batchSize(150);

  for await (const doc of cursor) {
    scanned++;
    const qd = doc.question_data;
    if (!qd || typeof qd !== 'object' || Array.isArray(qd)) continue;
    const q = qd as Record<string, unknown>;
    if (!isGeneratedQuestionExplanationEmpty(q.Explanation ?? q.explanation)) continue;
    if (!pickParagraph(q)) continue;
    eligible++;
    const typeStr = String(doc.type ?? '').trim();
    const explanation = buildBulkVariantExplanation(typeStr, q);
    if (!explanation.trim()) continue;
    if (dryRun) {
      updated++;
      continue;
    }
    const next = { ...q, Explanation: explanation };
    await col.updateOne(
      { _id: doc._id as ObjectId },
      { $set: { question_data: next, updated_at: new Date() } },
    );
    updated++;
    if (updated % 100 === 0) console.error(`  … ${updated}건 갱신`);
  }

  console.log(
    JSON.stringify(
      { ok: true, dryRun, textbook, scanned, eligibleEmptyWithParagraph: eligible, updated },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
