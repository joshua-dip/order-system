/**
 * essay_exams 를 examType(data.meta.examType)별로 카운트해 '서술형 출제 현황' 분리를 검증 (read-only).
 * coverage/passage-exam-counts 라우트가 쓰는 examTypeMatch 와 동일 기준.
 *
 * 실행: npx tsx scripts/diagnose-essay-examtype-counts.ts [--textbook "교재명"]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { getDb } from '@/lib/mongodb';
import { examTypeMatch } from '@/lib/essay-exams-store';
import { ESSAY_MEANING_EXAM_TYPE } from '@/app/data/essay-categories';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.join(PROJECT_ROOT, '.env') });
config({ path: path.join(PROJECT_ROOT, '.env.local') });

function getFlag(name: string): string {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : '';
}

async function main() {
  const db = await getDb('gomijoshua');
  const col = db.collection('essay_exams');
  const base = { isPlaceholder: { $ne: true } as unknown } as Record<string, unknown>;

  // 전체 examType 분포(상위)
  const dist = (await col
    .aggregate([
      { $match: base },
      { $group: { _id: '$data.meta.examType', n: { $sum: 1 } } },
      { $sort: { n: -1 } },
    ])
    .toArray()) as { _id: unknown; n: number }[];

  const out: Record<string, unknown> = {
    examType분포: dist.map((d) => ({ examType: d._id ?? '(없음/레거시)', count: d.n })),
  };

  const tb = getFlag('textbook').trim();
  if (tb) {
    const count = (m: Record<string, unknown>) => col.countDocuments({ ...base, textbook: tb, ...m });
    out[`교재 "${tb}"`] = {
      전체: await count({}),
      글의의미서술형: await count(examTypeMatch(ESSAY_MEANING_EXAM_TYPE)),
      그외_배열형등: await count(examTypeMatch('배열형')),
    };
  }

  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
