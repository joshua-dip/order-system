/**
 * 전 교재 — 배열(string[])로 저장된 Options → 표준 ### 문자열 변환 (2026-06-13).
 * 배열 저장은 회원 내보내기 str() 가드에 걸려 선택지가 통째로 누락되는 실버그.
 * 요소에 ①~⑤ 접두사가 있으면 그대로, 없으면 부여해 "① … ### ② …" 로 변환.
 * 가드: 요소 5개·빈/None 없음·접두사 전부있음 또는 전부없음(혼재 스킵)·CorrectAnswer 단일 동그라미.
 * 사용: npx tsx scripts/patch-all-array-options-20260613.ts [--apply]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { getDb } from '@/lib/mongodb';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.join(ROOT, '.env') }); config({ path: path.join(ROOT, '.env.local') });

const APPLY = process.argv.includes('--apply');
const CIRCLED = ['①', '②', '③', '④', '⑤'];
const CIRCLED_RE = /^[①②③④⑤]/;

async function main() {
  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');
  const docs = await col.find({ deleted_at: null, 'question_data.Options': { $type: 'array' } }).toArray();

  const now = new Date();
  let applied = 0;
  const skip: Record<string, number> = {};
  const byTextbook: Record<string, number> = {};
  for (const d of docs) {
    const qd = (d.question_data ?? {}) as Record<string, unknown>;
    const els = (qd.Options as unknown[]).map((v) => String(v ?? '').trim());
    const ca = String(qd.CorrectAnswer ?? '').trim();
    if (els.length !== 5) { skip['요소≠5'] = (skip['요소≠5'] ?? 0) + 1; continue; }
    if (els.some((e) => !e || /\bNone\b/.test(e))) { skip['None/빈요소'] = (skip['None/빈요소'] ?? 0) + 1; continue; }
    if (!/^[①②③④⑤]$/.test(ca)) { skip['CA비표준'] = (skip['CA비표준'] ?? 0) + 1; continue; }
    const withPrefix = els.filter((e) => CIRCLED_RE.test(e)).length;
    let newOptions: string;
    if (withPrefix === 5 && els.every((e, i) => e.startsWith(CIRCLED[i]))) {
      newOptions = els.join(' ### ');
    } else if (withPrefix === 0) {
      newOptions = els.map((e, i) => `${CIRCLED[i]} ${e}`).join(' ### ');
    } else { skip['접두사혼재'] = (skip['접두사혼재'] ?? 0) + 1; continue; }
    byTextbook[String(d.textbook)] = (byTextbook[String(d.textbook)] ?? 0) + 1;
    applied++;
    if (APPLY) await col.updateOne({ _id: d._id }, { $set: { 'question_data.Options': newOptions, updated_at: now } });
  }
  console.log(JSON.stringify({ ok: true, apply: APPLY, total: docs.length, converted: applied, skip, byTextbook }, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
