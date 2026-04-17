/**
 * generated_questions 중 question_data.Explanation 이 비어 있는 문항에 유형별 기본 해설을 채운다.
 *
 *   npx tsx scripts/fill-empty-gq-explanations.ts [--dry-run] [--textbook "부분일치"] [--limit 2000]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import {
  enrichQuestionDataWithExplanationIfEmpty,
  isGeneratedQuestionExplanationEmpty,
} from '@/lib/generated-question-explanation-fallback';

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

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const dryRun = flags.get('dry-run') === 'true';
  const textbook = (flags.get('textbook') ?? '').trim();
  const limit = Math.min(50_000, Math.max(1, parseInt(flags.get('limit') ?? '5000', 10) || 5000));

  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');

  const filter: Record<string, unknown> = {};
  if (textbook) filter.textbook = { $regex: textbook, $options: 'i' };

  const cursor = col.find(filter).project({ question_data: 1, type: 1, textbook: 1 }).limit(limit);

  let scanned = 0;
  let empty = 0;
  let updated = 0;
  for await (const doc of cursor) {
    scanned++;
    const qd = doc.question_data;
    if (!qd || typeof qd !== 'object' || Array.isArray(qd)) continue;
    const q = qd as Record<string, unknown>;
    if (!isGeneratedQuestionExplanationEmpty(q.Explanation ?? q.explanation)) continue;
    empty++;
    const typeStr = String(doc.type ?? '').trim();
    const next = enrichQuestionDataWithExplanationIfEmpty(q, typeStr);
    if (!next) continue;
    if (dryRun) {
      updated++;
      continue;
    }
    await col.updateOne(
      { _id: doc._id as ObjectId },
      { $set: { question_data: next, updated_at: new Date() } },
    );
    updated++;
  }

  console.log(
    JSON.stringify(
      { ok: true, dryRun, textbook: textbook || null, scanned, emptyExplanation: empty, updated },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
