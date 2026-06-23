/**
 * 주문 화면에서 강·번호가 안 뜨는 stale 교재명 진단 (read-only, DB 변경 없음).
 * 예: 회원 allowedTextbooksVariant 에 "지금필수 고난도유형(2024)" 가 남아있으나
 *     실제 데이터(passages/converted)는 "(2026)" 에만 있는 경우.
 *
 * 실행: npx tsx scripts/diagnose-stale-textbook-name.ts --like 고난도유형
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

function getFlag(name: string): string {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : '';
}

async function main() {
  const like = getFlag('like').trim() || '고난도유형';
  const re = new RegExp(like.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const db = await getDb('gomijoshua');

  // 1) passages 에 존재하는 해당 시리즈 교재명 + 지문 수
  const pRows = (await db
    .collection('passages')
    .aggregate([
      { $match: { textbook: { $regex: like } } },
      { $group: { _id: '$textbook', n: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ])
    .toArray()) as { _id: string; n: number }[];

  // 2) users.allowedTextbooksVariant 에 해당 시리즈가 들어간 분포
  const users = (await db
    .collection('users')
    .find({ allowedTextbooksVariant: { $regex: like } })
    .project({ loginId: 1, allowedTextbooksVariant: 1 })
    .toArray()) as { loginId?: string; allowedTextbooksVariant?: string[] }[];

  const nameCounts = new Map<string, number>();
  let bothYears = 0;
  for (const u of users) {
    const av = Array.isArray(u.allowedTextbooksVariant) ? u.allowedTextbooksVariant : [];
    const matches = [...new Set(av.filter((x) => typeof x === 'string' && re.test(x)))];
    for (const m of matches) nameCounts.set(m, (nameCounts.get(m) ?? 0) + 1);
    if (matches.some((m) => /\(2024\)/.test(m)) && matches.some((m) => /\(2026\)/.test(m))) bothYears += 1;
  }

  // 3) 모든 per-user 리스트 필드의 시리즈 이름 분포 (어떤 연도가 stale 인지)
  const allFields = [
    'allowedTextbooksVariant',
    'allowedTextbooks',
    'allowedTextbooksWorkbook',
    'allowedTextbooksEssay',
  ];
  const perFieldNameCounts: Record<string, Record<string, number>> = {};
  for (const f of allFields) {
    const docs = (await db
      .collection('users')
      .find({ [f]: { $regex: like } })
      .project({ [f]: 1 })
      .toArray()) as Record<string, unknown>[];
    const counts = new Map<string, number>();
    for (const d of docs) {
      const arr = Array.isArray(d[f]) ? (d[f] as unknown[]) : [];
      const matches = [...new Set(arr.filter((x) => typeof x === 'string' && re.test(x as string)) as string[])];
      for (const m of matches) counts.set(m, (counts.get(m) ?? 0) + 1);
    }
    perFieldNameCounts[f] = Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1]));
  }

  // 4) settings 컬렉션에 stale 이름이 있는지
  const settingsDocs = (await db.collection('settings').find({}).toArray()) as Record<string, unknown>[];
  const settingsHits = settingsDocs
    .filter((d) => JSON.stringify(d.value ?? d).match(re))
    .map((d) => ({ _id: String(d._id), values: (Array.isArray(d.value) ? d.value : []).filter((v: unknown) => typeof v === 'string' && re.test(v as string)) }));

  console.log(JSON.stringify({
    like,
    passagesTextbooks: pRows.map((r) => ({ textbook: r._id, passages: r.n })),
    usersWithSeries: users.length,
    nameCountsAmongUsers: Object.fromEntries([...nameCounts.entries()].sort((a, b) => b[1] - a[1])),
    usersHavingBoth2024and2026: bothYears,
    perFieldNameCounts,
    settingsHits,
  }, null, 2));
  process.exit(0);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
