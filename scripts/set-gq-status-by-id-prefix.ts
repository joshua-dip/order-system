/**
 * generated_questions._id 문자열 접두사로 문항을 찾아 status를 한 번에 갱신 (진단·일괄 보정용).
 * 접두당 정확히 1건일 때만 갱신한다.
 *
 *   npx tsx scripts/set-gq-status-by-id-prefix.ts <status> <idPrefix> [idPrefix2 ...]
 *   npx tsx scripts/set-gq-status-by-id-prefix.ts 검수불일치 69cb66dd 69cb6705
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

function isHexPrefix(s: string): boolean {
  return /^[a-fA-F0-9]+$/.test(s) && s.length >= 4 && s.length <= 24;
}

async function main() {
  const status = process.argv[2]?.trim();
  const prefixes = process.argv.slice(3).map((p) => p.trim()).filter(Boolean);
  if (!status || prefixes.length === 0) {
    console.error(
      '사용법: npx tsx scripts/set-gq-status-by-id-prefix.ts <status> <idPrefix> [idPrefix2 ...]'
    );
    process.exit(1);
  }
  for (const p of prefixes) {
    if (!isHexPrefix(p)) {
      console.error(`접두 "${p}"는 4~24자 hex여야 합니다.`);
      process.exit(1);
    }
  }

  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');

  for (const prefix of prefixes) {
    const plen = prefix.length;
    const cursor = col.find({
      $expr: {
        $eq: [{ $substrCP: [{ $toString: '$_id' }, 0, plen] }, prefix],
      },
    });
    const docs = await cursor.project({ _id: 1, status: 1, source: 1, type: 1 }).toArray();
    if (docs.length === 0) {
      console.log(JSON.stringify({ prefix, error: '일치 문항 없음' }));
      continue;
    }
    if (docs.length > 1) {
      console.log(
        JSON.stringify({
          prefix,
          error: '복수 일치 — 중단',
          count: docs.length,
          ids: docs.map((d) => String(d._id)),
        })
      );
      process.exit(1);
    }
    const id = docs[0]._id;
    const prev = String(docs[0].status ?? '');
    const r = await col.updateOne({ _id: id }, { $set: { status, updated_at: new Date() } });
    console.log(
      JSON.stringify({
        prefix,
        _id: String(id),
        prev_status: prev,
        new_status: status,
        modified: r.modifiedCount === 1,
      })
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
