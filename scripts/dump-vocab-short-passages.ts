/**
 * READ-ONLY: 부산진여고2 기말 범위에서 '어휘' 변형이 3개 미만인 지문의
 * passage_id + source_key + 영어 본문 + 현재 어휘 보유수 덤프. (어휘 Phase B 작성용)
 * 출력은 .variant-drafts/vocab-short.txt 에 저장.
 */
import path from 'path';
import fs from 'fs';
import { config } from 'dotenv';
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.resolve(process.cwd(), '.env.local') });
config({ path: path.resolve(process.cwd(), '.env') });
import { ObjectId } from 'mongodb';
import { getVipDb, col } from '../lib/vip-db';
import { getDb } from '../lib/mongodb';

const FINAL_EXAM_ID = '6a40a97568265d1b342a4e65';

function parseKey(key: string) { const i = key.indexOf('::'); return i < 0 ? { textbook: '', sourceKey: key } : { textbook: key.slice(0, i), sourceKey: key.slice(i + 2) }; }
function pickText(content: any): string {
  if (!content || typeof content !== 'object') return '';
  if (typeof content.original === 'string' && content.original.trim()) return content.original.trim();
  if (typeof content.mixed === 'string' && content.mixed.trim()) return content.mixed.trim();
  if (Array.isArray(content.sentences)) return content.sentences.map((s: any) => (typeof s === 'string' ? s : (s?.en ?? s?.text ?? ''))).filter(Boolean).join(' ');
  return '';
}

async function main() {
  const vipDb = await getVipDb();
  const exam = await col<any>(vipDb, 'schoolExams').findOne({ _id: new ObjectId(FINAL_EXAM_ID) });
  const keys: string[] = (exam?.examScopePassages ?? []).map(String);
  const pairs = keys.map(parseKey).filter((p) => p.sourceKey);
  const db = await getDb('gomijoshua');
  const or = pairs.map((p) => (p.textbook ? { textbook: p.textbook, source_key: p.sourceKey } : { source_key: p.sourceKey }));
  const passages = await db.collection('passages').find({ $or: or }).toArray();

  const pidList = passages.map((p) => p._id as ObjectId);
  const vocabAgg = await db.collection('generated_questions').aggregate([
    { $match: { passage_id: { $in: pidList }, type: '어휘', option_type: { $in: ['English', null] } } },
    { $group: { _id: '$passage_id', n: { $sum: 1 } } },
  ]).toArray();
  const vocabCount = new Map(vocabAgg.map((a) => [String(a._id), a.n]));

  passages.sort((a, b) => String(a.textbook).localeCompare(String(b.textbook), 'ko') || String(a.source_key).localeCompare(String(b.source_key), 'ko'));
  const out: string[] = [];
  let count = 0;
  for (const p of passages) {
    const have = vocabCount.get(String(p._id)) ?? 0;
    if (have >= 3) continue;
    count++;
    out.push(`===== #${count}  (어휘 보유 ${have}/3) =====`);
    out.push(`passage_id: ${p._id}`);
    out.push(`textbook: ${p.textbook}`);
    out.push(`source_key: ${p.source_key}`);
    out.push(`--- 본문 ---`);
    out.push(pickText(p.content));
    out.push('');
  }
  const dest = path.resolve(process.cwd(), '.variant-drafts/vocab-short.txt');
  fs.writeFileSync(dest, out.join('\n'), 'utf8');
  console.log(`어휘 부족 지문 ${count}개 → ${dest} 에 저장`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
