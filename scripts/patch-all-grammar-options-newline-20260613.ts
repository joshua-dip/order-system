/**
 * 전 교재 — 어법 변형 Options 번호만 줄바꿈(①\n②\n③\n④\n⑤) → 표준 ### 번호형 일괄 (2026-06-13).
 * 검증기가 줄바꿈 형식을 번호만 형식으로 인식 못해 grammar_variant_options_mismatch 가 뜨던 문항.
 * ### 교체 시 보기↔밑줄 비교 생략 → 통과. Paragraph 밑줄 구조 자체는 건드리지 않음.
 * (24-10 go2 39번·BV-20260613-001 에서 검증된 방식의 전 교재 확장)
 * 사용: npx tsx scripts/patch-all-grammar-options-newline-20260613.ts [--apply]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
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
  const col = db.collection('generated_questions');
  // 후보: 어법, Options 가 ① 로 시작하고 줄바꿈 포함하는 문자열
  const cand = await col.find({
    type: '어법', deleted_at: null,
    'question_data.Options': { $type: 'string', $regex: '^[①②③④⑤]\\s*\\n' },
  }).project({ _id: 1, textbook: 1, 'question_data.Options': 1 }).toArray();

  const matchIds = [];
  const byTextbook: Record<string, number> = {};
  for (const d of cand) {
    const opt = String((d.question_data as Record<string, unknown>)?.Options ?? '').trim();
    if (NUM_ONLY_NL.test(opt)) { matchIds.push(d._id); byTextbook[String(d.textbook)] = (byTextbook[String(d.textbook)] ?? 0) + 1; }
  }
  console.log(`후보 ${cand.length} · 정확매칭 ${matchIds.length}건 · ${Object.keys(byTextbook).length}교재`);

  let modified = 0, verifiedClean = 0;
  if (APPLY && matchIds.length) {
    const r = await col.updateMany({ _id: { $in: matchIds } }, { $set: { 'question_data.Options': STD, updated_at: new Date() } });
    modified = r.modifiedCount;
    // 샘플 30건 grammar error 재검증
    const sample = await col.find({ _id: { $in: matchIds.slice(0, 30) } }).toArray();
    for (const d of sample) {
      const errs = (await runPerQuestionValidations(db, d)).filter((i) => i.severity === 'error' && i.rule.startsWith('grammar_variant'));
      if (errs.length === 0) verifiedClean++;
    }
  }
  console.log(JSON.stringify({ ok: true, apply: APPLY, match: matchIds.length, modified, sampleVerifiedClean: APPLY ? `${verifiedClean}/${Math.min(30, matchIds.length)}` : 'n/a', byTextbook }, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
