/** 일회용 패치: BV-20260629-001 검수 결함 2건 교정 (updateOne, 재저장 아님) */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.join(ROOT, '.env') });
config({ path: path.join(ROOT, '.env.local') });

const BLANK = '<u>' + '_'.repeat(50) + '</u>';
const DRY = process.argv.includes('--dry-run');

async function main() {
  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');

  // ── 결함 1: 11강 04번 빈칸 — Paragraph 빈칸 표식 누락
  const id1 = new ObjectId('69c027ea5f2026cf9265dacb');
  const d1 = await col.findOne({ _id: id1 });
  if (!d1) throw new Error('결함1 문항 없음');
  const qd1 = (d1.question_data ?? {}) as Record<string, unknown>;
  const para1 = String(qd1.Paragraph ?? '');
  if (/_{3,}|<u\b/i.test(para1)) throw new Error('결함1: 이미 빈칸 표식 존재 — 중단');
  // 정답 ②의 절(닫는 따옴표·마침표 포함)을 빈칸으로 치환.
  // 마침표가 인용부호 안쪽("a great value.")이라 다음 문장 시작("Americans have created")까지 소비.
  const re = /which are perceived as[\s\S]*?great value[\s\S]*?(?=\s+Americans have created)/;
  const matches = para1.match(new RegExp(re, 'g')) ?? [];
  if (matches.length !== 1) throw new Error(`결함1: 치환 대상 매칭 ${matches.length}건 (1건이어야 함)`);
  const newPara1 = para1.replace(re, `${BLANK}.`);
  console.log('── 결함1 (11강 04번 빈칸) ──');
  console.log('치환된 절:', JSON.stringify(matches[0]));
  console.log('after >>>', newPara1.slice(Math.max(0, newPara1.indexOf(BLANK) - 40), newPara1.indexOf(BLANK) + BLANK.length + 40));

  // ── 결함 2: 21강 02번 요약 — 해설 헤더가 ④인데 CorrectAnswer ③
  const id2 = new ObjectId('69c4248893957bcf0156f0fa');
  const d2 = await col.findOne({ _id: id2 });
  if (!d2) throw new Error('결함2 문항 없음');
  const qd2 = (d2.question_data ?? {}) as Record<string, unknown>;
  const ca2 = String(qd2.CorrectAnswer ?? '').trim();
  const exp2 = String(qd2.Explanation ?? '');
  if (ca2 !== '③') throw new Error(`결함2: CorrectAnswer 가 ③ 아님(${ca2}) — 가정 깨짐, 중단`);
  if (!exp2.includes('④')) throw new Error('결함2: 기존 해설에 ④ 없음 — 가정 깨짐, 중단');
  const newExp2 = [
    '③ contended - concluded',
    '주장했다 - 결론지었다',
    '*해설: 르네 데카르트는 우리의 감각이 우리를 잘못된 사실을 믿도록 오도할 수 있다고 주장했으나(contended), 궁극적으로 그가 생각할 수 있기 때문에 감각의 속임수와 상관없이 그는 존재한다고 결론지었다(concluded). 빈칸 (A)에는 감각이 우리를 오도할 수 있다는 완곡한 철학적 주장을 나타내는 \'주장했다(contended)\', (B)에는 추론의 귀결을 나타내는 \'결론지었다(concluded)\'가 가장 적절하다.',
  ].join('\n');
  console.log('\n── 결함2 (21강 02번 요약) ──');
  console.log('CorrectAnswer:', ca2, '(유지)');
  console.log('해설 헤더 ④→③ 재작성');

  if (DRY) { console.log('\n[dry-run] 변경 미적용'); process.exit(0); }

  const now = new Date();
  const r1 = await col.updateOne({ _id: id1 }, { $set: { 'question_data.Paragraph': newPara1, updated_at: now } });
  const r2 = await col.updateOne({ _id: id2 }, { $set: { 'question_data.Explanation': newExp2, updated_at: now } });
  console.log(`\n적용: 결함1 modified=${r1.modifiedCount}, 결함2 modified=${r2.modifiedCount}`);
  process.exit(0);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
