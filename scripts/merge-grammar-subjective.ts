/**
 * 문법 문제은행 — 객관식 전환 전 「주관식 원형」을 같은 문서에 병합한다.
 * (문항 중복 없이 한 문제가 두 표현형을 가짐: options=객관식, subjective=주관식 원형)
 *
 * 사용:
 *   npx tsx scripts/merge-grammar-subjective.ts --user-id <ObjectId> --source "자체 제작 LEVEL 1" \
 *     [--dry-run] originals1.json originals2.json ...
 *   (originals = 전환 전 JSON — units[].sections[].items[] 스키마, B/C/D 섹션만 반영)
 */
import { loadCliEnv } from './_cli-env';
import fs from 'fs';
import path from 'path';
import { ObjectId } from 'mongodb';
import { getDb } from '../lib/mongodb';
import { GRAMMAR_PROBLEMS_COLLECTION } from '../lib/vip-grammar-problem-bank';

loadCliEnv(path.resolve(__dirname, '..'));

interface ItemIn { no: number; question: string; answer: string; explanation?: string; choices?: string[] }
interface SectionIn { label: string; type: string; instruction: string; choices?: string[]; items: ItemIn[] }
interface UnitIn { unit: number; sections: SectionIn[] }

function fail(msg: string): never { console.error('❌', msg); process.exit(1); }

async function main() {
  const args = process.argv.slice(2);
  const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
  const dryRun = args.includes('--dry-run');
  const userIdRaw = opt('user-id') ?? '';
  const source = opt('source') ?? '자체 제작';
  const files = args.filter((a, i) => !a.startsWith('--') && !['--user-id', '--source'].includes(args[i - 1] ?? ''));
  if (!ObjectId.isValid(userIdRaw)) fail('--user-id 필요');
  if (!files.length) fail('원본 JSON 파일이 없습니다.');

  const db = await getDb('gomijoshua');
  const col = db.collection(GRAMMAR_PROBLEMS_COLLECTION);
  const userId = new ObjectId(userIdRaw);

  let matched = 0, missing = 0, questionDrift = 0;
  for (const f of files) {
    const data = JSON.parse(fs.readFileSync(path.resolve(f), 'utf8')) as { units: UnitIn[] };
    for (const u of data.units) {
      for (const sec of u.sections) {
        if (sec.label === 'A') continue; // A 선택형은 전환 안 됐으므로 원형 병합 불필요
        for (const it of sec.items) {
          const key = { userId, source, unit: u.unit, section: sec.label, no: it.no };
          const doc = await col.findOne(key, { projection: { question: 1 } });
          if (!doc) { missing++; console.warn('없음:', JSON.stringify(key)); continue; }
          if ((doc.question ?? '') !== it.question) questionDrift++; // 정보용 — 본문은 전환 시 불변이어야 함
          const subjective = {
            type: sec.type,
            instruction: sec.instruction,
            answer: it.answer,
            ...(it.choices?.length ? { choices: it.choices } : sec.choices?.length ? { choices: sec.choices } : {}),
          };
          matched++;
          if (!dryRun) await col.updateOne(key, { $set: { subjective, updatedAt: new Date() } });
        }
      }
    }
  }
  console.log(`${dryRun ? '[dry-run] ' : ''}병합 ${matched}건, 미매칭 ${missing}건, 본문 불일치 ${questionDrift}건`);
  process.exit(missing > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
