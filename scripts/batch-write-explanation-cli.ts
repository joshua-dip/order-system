/**
 * DB에서 해설이 비어 있는 변형문을 고른 뒤, `generateQuestionExplanationWithClaude`로 해설을 생성해 저장한다.
 * (관리자 API write-explanation과 동일 프롬프트·로직)
 *
 *   npx tsx scripts/batch-write-explanation-cli.ts [--textbook "얇고 빠른 미니 모의고사 입문"] [--limit 10]
 *
 * 필요: ANTHROPIC_API_KEY (.env.local)
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { generateQuestionExplanationWithClaude } from '@/lib/generate-question-explanation-claude';
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

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const textbook = (flags.get('textbook') ?? '얇고 빠른 미니 모의고사 입문').trim();
  const limit = Math.min(50, Math.max(1, parseInt(flags.get('limit') ?? '10', 10) || 10));

  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    console.error('ANTHROPIC_API_KEY가 없습니다. .env.local에 설정 후 다시 실행하세요.');
    process.exit(1);
  }

  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');

  const candidates = await col
    .aggregate<{ _id: ObjectId }>([
      { $match: { textbook } },
      {
        $match: {
          $expr: {
            $gt: [
              {
                $strLenCP: {
                  $trim: { input: { $toString: { $ifNull: ['$question_data.Paragraph', ''] } } },
                },
              },
              0,
            ],
          },
        },
      },
      {
        $addFields: {
          ex: { $ifNull: ['$question_data.Explanation', '$question_data.explanation'] },
        },
      },
      {
        $match: {
          $or: [
            { ex: { $exists: false } },
            { ex: null },
            { ex: '' },
            { $expr: { $eq: [{ $strLenCP: { $trim: { input: { $toString: '$ex' } } } }, 0] } },
          ],
        },
      },
      { $sort: { _id: 1 } },
      { $limit: limit },
      { $project: { _id: 1 } },
    ])
    .toArray();

  if (candidates.length === 0) {
    console.log(JSON.stringify({ ok: true, message: '대상 문항이 없습니다.', textbook, limit }, null, 2));
    return;
  }

  const results: unknown[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const id = candidates[i]._id;
    const existing = await col.findOne({ _id: id });
    if (!existing) continue;
    const qd = existing.question_data;
    if (!qd || typeof qd !== 'object' || Array.isArray(qd)) continue;
    const q = qd as Record<string, unknown>;
    if (!isGeneratedQuestionExplanationEmpty(q.Explanation ?? q.explanation)) continue;

    const type = String(existing.type ?? '').trim();
    const result = await generateQuestionExplanationWithClaude({
      questionData: q,
      type,
    });
    if (!result.ok) {
      results.push({ id: String(id), ok: false, error: result.error, status: result.status });
      continue;
    }
    const nextQuestionData = { ...q, Explanation: result.explanation };
    await col.updateOne(
      { _id: id },
      { $set: { question_data: nextQuestionData, updated_at: new Date() } },
    );
    results.push({ id: String(id), ok: true, source: existing.source, type });
    if (i + 1 < candidates.length) await new Promise((r) => setTimeout(r, 900));
  }

  console.log(JSON.stringify({ ok: true, textbook, requested: limit, processed: results.length, results }, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
