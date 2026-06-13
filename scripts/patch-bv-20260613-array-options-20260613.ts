/**
 * BV-20260613-001 — 배열 저장 Options 2건 → ### 문자열 변환 (2026-06-13).
 * 09강 05번(주제)·10강 패턴맛보기1번(일치). 요소가 이미 ①~⑤ 접두사 포함 정상 영어.
 * 사용: npx tsx scripts/patch-bv-20260613-array-options-20260613.ts [--apply]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.join(ROOT, '.env') }); config({ path: path.join(ROOT, '.env.local') });
const APPLY = process.argv.includes('--apply');
const CIRCLED = ['①','②','③','④','⑤'];
async function main() {
  const db = await getDb('gomijoshua');
  const order = await db.collection('orders').findOne({ orderNumber: 'BV-20260613-001' });
  const m = (order!.orderMeta ?? {}) as Record<string, unknown>;
  const lessons = [...new Set((m.selectedLessons as unknown[]).map((l) => String(l).trim()))];
  const passages = await db.collection('passages').find({ textbook: m.selectedTextbook, source_key: { $in: lessons } }).project({ _id: 1 }).toArray();
  const ids = passages.map((p) => p._id as ObjectId); const idStrs = ids.map((o) => o.toString());
  const col = db.collection('generated_questions');
  const docs = await col.find({ $or: [{ passage_id: { $in: ids } }, { passage_id: { $in: idStrs } }], deleted_at: null, 'question_data.Options': { $type: 'array' } }).toArray();
  const now = new Date(); const report: Record<string, unknown>[] = [];
  for (const d of docs) {
    const els = ((d.question_data as Record<string, unknown>).Options as unknown[]).map((v) => String(v ?? '').trim());
    if (els.length !== 5 || els.some((e) => !e || /\bNone\b/.test(e)) || !els.every((e, i) => e.startsWith(CIRCLED[i]))) {
      report.push({ id: String(d._id), source: d.source, error: '비정상 요소 — 건너뜀' }); continue;
    }
    const newOptions = els.join(' ### ');
    report.push({ id: String(d._id), source: d.source, action: APPLY ? '변환' : '변환 예정' });
    if (APPLY) await col.updateOne({ _id: d._id }, { $set: { 'question_data.Options': newOptions, updated_at: now } });
  }
  console.log(JSON.stringify({ ok: true, apply: APPLY, applied: report.filter((r) => r.action).length, report }, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
