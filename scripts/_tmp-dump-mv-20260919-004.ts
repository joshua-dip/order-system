/**
 * Dump MV-20260919-004 passages for 함의 drafts.
 *   npx tsx scripts/_tmp-dump-mv-20260919-004.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ObjectId } from 'mongodb';
import { loadCliEnv } from './_cli-env';
import { getDb } from '@/lib/mongodb';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadCliEnv(ROOT);

const IDS = [
  '69e27c8172a886137cd845bf', '69e27c8172a886137cd845c0', '69e27c8172a886137cd845c1',
  '69e27c8172a886137cd845c2', '69e27c8172a886137cd845c3', '69e27c8172a886137cd845c4',
  '69e27c8172a886137cd845c5', '69e27c8172a886137cd845c6', '69e27c8172a886137cd845c7',
  '69e27c8172a886137cd845c8', '69e27c8172a886137cd845c9', '69e27c8172a886137cd845ca',
  '69e27c8172a886137cd845cb', '69e27c8172a886137cd845cc', '69e27c8172a886137cd845cd',
  '69e27c8172a886137cd845ce', '69e27c8172a886137cd845cf', '69e27c8172a886137cd845d0',
  '69e27c8172a886137cd845d1', '69e27c8172a886137cd845d2', '69e27c8172a886137cd845d3',
  '69e27c8172a886137cd845d4',
];

async function main() {
  const db = await getDb('gomijoshua');
  const docs = await db
    .collection('passages')
    .find({ _id: { $in: IDS.map((id) => new ObjectId(id)) } })
    .toArray();
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  const out = IDS.map((id) => {
    const d = byId.get(id) as Record<string, unknown> | undefined;
    if (!d) return { passage_id: id, error: 'missing' };
    const c = (d.content || {}) as Record<string, unknown>;
    return {
      passage_id: id,
      textbook: String(d.textbook ?? ''),
      source: String(d.source_key ?? d.source ?? ''),
      original: String(c.original ?? ''),
    };
  });
  const dir = path.join(ROOT, '.variant-drafts/mv-20260919-004');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'passages.json'), JSON.stringify(out, null, 2));
  const size = 4;
  let shard = 0;
  for (let i = 0; i < out.length; i += size) {
    shard += 1;
    const chunk = out.slice(i, i + size);
    fs.writeFileSync(
      path.join(dir, `shard-${String(shard).padStart(2, '0')}.json`),
      JSON.stringify(chunk, null, 2),
    );
    console.log(`shard-${String(shard).padStart(2, '0')}: ${chunk.length}`, chunk.map((c) => ('source' in c ? c.source : '?')).join(', '));
  }
  console.log(JSON.stringify({ total: out.length, shards: shard, missing: out.filter((x) => 'error' in x).length }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
