/**
 * 자동 마이그레이션:
 *  (a) 삽입_Paragraph없음 → InsertSentence + "\n\n" + PassageWithPositions → Paragraph
 *      비표준 키(PassageWithPositions, InsertSentence, AnswerExplanation, QuestionType) 제거
 *      CorrectAnswer 숫자(1~5) → 동그라미(①~⑤)
 *  (b) 요약_요약문없음 → Paragraph 끝에 "\n\n→ {SummarySentence}" 추가
 *
 * 사용:
 *   npx tsx scripts/migrate-paragraph-summary.ts insertion <id> [id...]
 *   npx tsx scripts/migrate-paragraph-summary.ts summary <id> [id...]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.join(PROJECT_ROOT, '.env') });
config({ path: path.join(PROJECT_ROOT, '.env.local') });

const CIRCLED = ['①', '②', '③', '④', '⑤'];

function digitToCircled(s: string): string {
  const m = s.trim();
  const i = parseInt(m, 10);
  if (Number.isFinite(i) && i >= 1 && i <= 5) return CIRCLED[i - 1];
  return m;
}

async function main() {
  const mode = process.argv[2];
  const ids = process.argv.slice(3);
  if (!mode || ids.length === 0) {
    console.error('사용법: npx tsx scripts/migrate-paragraph-summary.ts insertion|summary <id>...');
    process.exit(1);
  }

  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');

  for (const id of ids) {
    const doc = await col.findOne({ _id: new ObjectId(id) });
    if (!doc) { console.log(JSON.stringify({ id, error: '문항 없음' })); continue; }
    const qd = (doc.question_data ?? {}) as Record<string, unknown>;
    const $set: Record<string, unknown> = {};
    const $unset: Record<string, unknown> = {};

    if (mode === 'insertion') {
      const ins = String(qd.InsertSentence ?? '').trim();
      const pwp = String(qd.PassageWithPositions ?? '').trim();
      if (ins && pwp) {
        $set['question_data.Paragraph'] = `${ins}\n\n${pwp}`;
        $unset['question_data.InsertSentence'] = '';
        $unset['question_data.PassageWithPositions'] = '';
      } else {
        console.log(JSON.stringify({ id, skip: 'InsertSentence 또는 PassageWithPositions 없음' }));
        continue;
      }
      // CorrectAnswer 숫자 → 동그라미
      const ca = String(qd.CorrectAnswer ?? '').trim();
      if (/^[1-5]$/.test(ca)) {
        $set['question_data.CorrectAnswer'] = digitToCircled(ca);
      }
      // Options 정리: \n로 구분된 ①②③④⑤ → ### 구분
      const opts = String(qd.Options ?? '').trim();
      if (opts && opts.includes('\n') && !opts.includes('###')) {
        $set['question_data.Options'] = '① ### ② ### ③ ### ④ ### ⑤';
      }
      // QuestionType / AnswerExplanation 정리
      if ('QuestionType' in qd) $unset['question_data.QuestionType'] = '';
      if ('AnswerExplanation' in qd && 'Explanation' in qd) {
        // Explanation이 정형해설이면 AnswerExplanation으로 대체
        const expl = String(qd.Explanation ?? '');
        const ans = String(qd.AnswerExplanation ?? '');
        if (expl.includes('가장 자연스러운 곳입니다') && ans.length > 30) {
          // CorrectAnswer 동그라미로 시작하도록
          const c = digitToCircled(String(qd.CorrectAnswer ?? ca));
          $set['question_data.Explanation'] = `${c}이 정답입니다. ${ans}`;
        }
        $unset['question_data.AnswerExplanation'] = '';
      }
    } else if (mode === 'summary') {
      const summary = String(qd.SummarySentence ?? '').trim();
      const para = String(qd.Paragraph ?? '');
      if (summary && para && !para.includes('(A)')) {
        $set['question_data.Paragraph'] = `${para}\n\n→ ${summary}`;
      } else if (summary && !para) {
        console.log(JSON.stringify({ id, skip: 'Paragraph 없음 — 원문 별도 필요' }));
        continue;
      } else if (!summary) {
        console.log(JSON.stringify({ id, skip: 'SummarySentence 없음' }));
        continue;
      } else {
        console.log(JSON.stringify({ id, skip: '이미 (A) 표시 있음' }));
        continue;
      }
      // SummarySentence 키 제거 (Paragraph로 통합)
      $unset['question_data.SummarySentence'] = '';
    } else {
      console.error('알 수 없는 모드:', mode); process.exit(1);
    }

    if (Object.keys($set).length > 0) $set['updated_at'] = new Date();
    const updateOp: Record<string, unknown> = {};
    if (Object.keys($set).length > 0) updateOp['$set'] = $set;
    if (Object.keys($unset).length > 0) updateOp['$unset'] = $unset;
    if (Object.keys(updateOp).length === 0) {
      console.log(JSON.stringify({ id, skip: '변경 없음' }));
      continue;
    }
    const r = await col.updateOne({ _id: new ObjectId(id) }, updateOp);
    console.log(JSON.stringify({ id, type: doc.type, modified: r.modifiedCount === 1 }));
  }
}
main().catch(e => { console.error(e); process.exit(1); });
