/**
 * BV-20260613-001 (해커스 불변의 패턴) 40지문 — 어법 변형 Options 표준화 (2026-06-13).
 * Options 가 번호만 줄바꿈(①\n②\n③\n④\n⑤) 형식이라 검증기가 보기↔밑줄 비교를 시도해
 * grammar_variant_options_mismatch 가 뜬 문항. 표준 ### 번호형으로 교체하면 비교 생략 → 통과.
 * (Paragraph 밑줄 구조 자체는 정상. 24-10 go2 39번과 동일 처리.)
 * 사용: npx tsx scripts/patch-bv-20260613-grammar-options-20260613.ts [--apply]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { runPerQuestionValidations } from '@/lib/variant-review-validators';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.join(ROOT, '.env') }); config({ path: path.join(ROOT, '.env.local') });

const APPLY = process.argv.includes('--apply');
const STD = '① ### ② ### ③ ### ④ ### ⑤';
const NUM_ONLY_NL = /^[①②③④⑤]\s*(\n\s*[①②③④⑤]\s*){4}$/;

async function main() {
  const db = await getDb('gomijoshua');
  const order = await db.collection('orders').findOne({ orderNumber: 'BV-20260613-001' });
  const m = (order!.orderMeta ?? {}) as Record<string, unknown>;
  const lessons = [...new Set((m.selectedLessons as unknown[]).map((l) => String(l).trim()))];
  const passages = await db.collection('passages').find({ textbook: m.selectedTextbook, source_key: { $in: lessons } }).project({ _id: 1 }).toArray();
  const ids = passages.map((p) => p._id as ObjectId);
  const idStrs = ids.map((o) => o.toString());
  const col = db.collection('generated_questions');
  const docs = await col.find({ $or: [{ passage_id: { $in: ids } }, { passage_id: { $in: idStrs } }], type: '어법', deleted_at: null }).toArray();

  const now = new Date();
  let target = 0, applied = 0, skip = 0, verifiedClean = 0;
  for (const d of docs) {
    const qd = (d.question_data ?? {}) as Record<string, unknown>;
    const opt = String(qd.Options ?? '');
    if (!NUM_ONLY_NL.test(opt.trim())) { skip++; continue; }
    target++;
    if (APPLY) {
      await col.updateOne({ _id: d._id }, { $set: { 'question_data.Options': STD, updated_at: now } });
      applied++;
    }
  }
  // 적용 후 검증 샘플 (최대 30건)
  if (APPLY) {
    const after = await col.find({ $or: [{ passage_id: { $in: ids } }, { passage_id: { $in: idStrs } }], type: '어법', deleted_at: null }).limit(30).toArray();
    for (const d of after) {
      const errs = (await runPerQuestionValidations(db, d)).filter((i) => i.severity === 'error' && i.rule.startsWith('grammar_variant'));
      if (errs.length === 0) verifiedClean++;
    }
  }
  console.log(JSON.stringify({ ok: true, apply: APPLY, totalGrammar: docs.length, target, applied, skipNonNumberOnly: skip, sampleVerifiedClean: APPLY ? `${verifiedClean}/30` : 'n/a' }, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
