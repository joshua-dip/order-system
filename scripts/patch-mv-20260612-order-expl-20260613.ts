/**
 * MV-20260612-001 9지문 — 순서 유형 해설 선언번호 ↔ CorrectAnswer 불일치 치환 (2026-06-13).
 * 셔플 후 해설 번호가 갱신 안 된 케이스. 해설 본문 (A)(B)(C) 논증·마지막 순열은 CA와 정합.
 * 가드: 해설 동그라미가 선언번호 1종 + 마지막 순열이 고정 5세트에서 CA 위치와 일치할 때만.
 * 사용: npx tsx scripts/patch-mv-20260612-order-expl-20260613.ts [--apply]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { getDb } from '@/lib/mongodb';
import { extractDeclaredAnswer } from '@/lib/content-integrity-validation';
import { ORDER_FIXED_OPTIONS } from '@/lib/order-variant-validation';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.join(PROJECT_ROOT, '.env') });
config({ path: path.join(PROJECT_ROOT, '.env.local') });

const APPLY = process.argv.includes('--apply');
const CIRCLED = ['①', '②', '③', '④', '⑤'];
const SOURCES = [
  '18년 9월 고2 영어모의고사 37번',
  '24년 3월 고2 영어모의고사 34번',
  '수능_2023_11월_2024수능(평가원) 33번',
  '22년 9월 고2 영어모의고사 38번',
  '수능_2016_11월_2017수능(평가원) 31번',
  '수능_2013_11월_2014수능A형(평가원) 35번',
  '22년 9월 고2 영어모의고사 37번',
  '수능_2010_11월_2011수능(평가원) 26번',
  '20년 6월 고3 영어모의고사 40번',
];

async function main() {
  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');
  const now = new Date();
  const report: Record<string, unknown>[] = [];

  const docs = await col.find({ source: { $in: SOURCES }, type: '순서', deleted_at: null }).toArray();
  for (const d of docs) {
    const qd = (d.question_data ?? {}) as Record<string, unknown>;
    const ca = String(qd.CorrectAnswer ?? '').trim();
    const expl = String(qd.Explanation ?? '');
    if (!/^[①②③④⑤]$/.test(ca)) continue;
    const declared = extractDeclaredAnswer(expl);
    if (!declared || declared === ca) continue;
    const circled = [...new Set(expl.match(/[①②③④⑤]/g) ?? [])];
    if (circled.length !== 1 || circled[0] !== declared) {
      report.push({ id: String(d._id), source: d.source, error: `해설 동그라미 혼재(${circled.join(',')}) — 수동` });
      continue;
    }
    const perms = expl.match(/\([ABC]\)\s*-\s*\([ABC]\)\s*-\s*\([ABC]\)/g) ?? [];
    const last = perms[perms.length - 1]?.replace(/\s+/g, '');
    const idx = last ? (ORDER_FIXED_OPTIONS as readonly string[]).indexOf(last) : -1;
    if (idx < 0 || CIRCLED[idx] !== ca) {
      report.push({ id: String(d._id), source: d.source, error: `해설 순열(${last ?? '?'})이 CA(${ca})와 불일치 — 수동` });
      continue;
    }
    report.push({ id: String(d._id), source: d.source, detail: `${declared} → ${ca}`, action: APPLY ? '치환' : '치환 예정' });
    if (APPLY) {
      await col.updateOne({ _id: d._id }, { $set: { 'question_data.Explanation': expl.split(declared).join(ca), updated_at: now } });
    }
  }

  console.log(JSON.stringify({
    ok: true, apply: APPLY,
    applied: report.filter((r) => r.action).length,
    items: report,
  }, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
