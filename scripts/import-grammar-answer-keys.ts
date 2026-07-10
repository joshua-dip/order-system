/**
 * 교재 정답키 임포트 — 그래머와이즈 등 시판 교재의 UNIT별 Grammar Exercises 정답을
 * vip_grammar_answer_keys 에 넣는다. 정답 사실만 저장(문제 본문·해설 없음), 내부 전용.
 *
 * 사용:
 *   npx tsx scripts/import-grammar-answer-keys.ts --user-id <ObjectId> [--dry-run] L1.json L2.json ...
 *
 * JSON: { "book": "그래머와이즈 LEVEL 1", "units": [ { "unit": 1, "chapter": "...", "title": "...",
 *          "exercises": { "A": ["am","are",...], "B": [...], "C": [...], "D": [...] } } ] }
 * 멱등: (userId, book, unit) upsert.
 */
import { loadCliEnv } from './_cli-env';
import fs from 'fs';
import path from 'path';
import { ObjectId } from 'mongodb';
import { getDb } from '../lib/mongodb';
import { GRAMMAR_ANSWER_KEY_COLLECTION, ensureAnswerKeyIndexes, type GrammarAnswerKeyDoc } from '../lib/vip-grammar-answer-key';

loadCliEnv(path.resolve(__dirname, '..'));

function fail(m: string): never { console.error('❌', m); process.exit(1); }

interface UnitIn { unit: number; chapter: string; title: string; exercises: Record<string, string[]> }

async function main() {
  const args = process.argv.slice(2);
  const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
  const dryRun = args.includes('--dry-run');
  const userIdRaw = opt('user-id') ?? '';
  const files = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--user-id');
  if (!ObjectId.isValid(userIdRaw)) fail('--user-id 필요');
  if (!files.length) fail('JSON 파일이 없습니다.');

  const db = await getDb('gomijoshua');
  await ensureAnswerKeyIndexes(db);
  const col = db.collection<GrammarAnswerKeyDoc>(GRAMMAR_ANSWER_KEY_COLLECTION);
  const userId = new ObjectId(userIdRaw);
  const now = new Date();

  let books = 0, units = 0, answers = 0;
  const rows: Array<{ book: string; u: UnitIn }> = [];
  for (const f of files) {
    const p = path.resolve(f);
    if (!fs.existsSync(p)) fail(`파일 없음: ${p}`);
    const data = JSON.parse(fs.readFileSync(p, 'utf8')) as { book: string; units: UnitIn[] };
    if (!data.book || !Array.isArray(data.units)) fail(`${f}: book/units 없음`);
    books++;
    const seen = new Set<number>();
    for (const u of data.units) {
      if (typeof u.unit !== 'number') fail(`${f}: unit 번호 없음`);
      if (seen.has(u.unit)) fail(`${f}: unit 중복 ${u.unit}`);
      seen.add(u.unit);
      const ex = u.exercises || {};
      let cnt = 0;
      for (const k of Object.keys(ex)) {
        if (!Array.isArray(ex[k])) fail(`${f}: u${u.unit} ${k} 배열 아님`);
        if (ex[k].some((a) => typeof a !== 'string' || !a.trim())) fail(`${f}: u${u.unit} ${k} 빈 정답`);
        cnt += ex[k].length;
      }
      if (cnt === 0) fail(`${f}: u${u.unit} 정답 0개`);
      answers += cnt; units++;
      rows.push({ book: data.book, u });
    }
  }
  console.log(`검증 통과: 교재 ${books} / UNIT ${units} / 정답 ${answers}`);
  if (dryRun) { console.log('dry-run — DB 미변경'); process.exit(0); }

  let up = 0;
  for (const { book, u } of rows) {
    const answerCount = Object.values(u.exercises).reduce((s, a) => s + a.length, 0);
    await col.updateOne(
      { userId, book, unit: u.unit },
      {
        $set: {
          chapter: u.chapter ?? '', title: u.title ?? '', exercises: u.exercises,
          answerCount, source: 'grammarwise-official', internal: true, updatedAt: now,
        },
        $setOnInsert: { userId, book, unit: u.unit, createdAt: now },
      },
      { upsert: true },
    );
    up++;
  }
  console.log(`완료: ${up} UNIT upsert (${books}권, 정답 ${answers}개)`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
