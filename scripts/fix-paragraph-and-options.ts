/**
 * 38개 문항 Paragraph 필드 추가 + Options 형식 수정
 *
 * 타입별 처리:
 *   어법        → PassageWithUnderlines → Paragraph (rename)
 *   빈칸        → PassageWithBlank → Paragraph (rename)
 *   삽입-고난도 → InsertSentence + "\n\n" + PassageWithPositions → Paragraph
 *   주제/제목/일치/불일치/요약 → passage 원문 → Paragraph
 *   함의        → Question에서 '...' 구절 추출 → 원문에서 <u>...</u> 적용 → Paragraph
 *
 * 요약 Options 객체 → "① A – B ### ② A – B ### ..." 문자열 변환
 *
 * 사용: npx tsx scripts/fix-paragraph-and-options.ts <id> [id2 ...]
 * 또는: npx tsx scripts/fix-paragraph-and-options.ts --all-38
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

const ALL_38_IDS = [
  '69e39e6c75254d46b7793c2b','69e39e7175254d46b7793c2c',
  '69e39e7d75254d46b7793c2d','69e39e8175254d46b7793c2e','69e39e8575254d46b7793c2f',
  '69e39e8d75254d46b7793c30','69e39e9075254d46b7793c31','69e39e9375254d46b7793c32',
  '69e39ea675254d46b7793c33','69e39eac75254d46b7793c34','69e39eb375254d46b7793c35',
  '69e39f7875254d46b7793c36','69e39f7b75254d46b7793c37','69e39f7e75254d46b7793c38',
  '69e39f8575254d46b7793c39','69e39f8575254d46b7793c3a','69e39f8775254d46b7793c3b',
  '69e39f9275254d46b7793c3c','69e39f9675254d46b7793c3d','69e39f9a75254d46b7793c3e',
  '69e39f9e75254d46b7793c3f','69e39fa175254d46b7793c40','69e39fa575254d46b7793c41',
  '69e39fb075254d46b7793c42','69e39fb775254d46b7793c43','69e39fbc75254d46b7793c44',
  '69e39fc475254d46b7793c45','69e39fc975254d46b7793c46','69e39fcc75254d46b7793c47',
  '69e39fdf75254d46b7793c48','69e39fe675254d46b7793c49','69e39fee75254d46b7793c4a',
  '69e39ff175254d46b7793c4b','69e39ff575254d46b7793c4c','69e39ff975254d46b7793c4d',
  '69e3a01475254d46b7793c4e','69e3a01975254d46b7793c4f','69e3a01f75254d46b7793c50',
];

const CIRCLED = ['①','②','③','④','⑤'];

function extractImpliedClause(question: string): string {
  // "밑줄 친 '...'이" 패턴에서 '...' 추출
  const m = question.match(/'([^']+)'/);
  return m ? m[1] : '';
}

function applyUnderline(original: string, clause: string): string {
  if (!clause) return original;
  const escaped = clause.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const updated = original.replace(new RegExp(escaped), `<u>${clause}</u>`);
  return updated === original ? original : updated; // 매칭 실패 시 원문 그대로
}

function optionsObjectToString(opts: unknown): string {
  if (typeof opts === 'string') return opts;
  if (!opts || typeof opts !== 'object' || Array.isArray(opts)) return '';
  const obj = opts as Record<string, unknown>;
  const parts: string[] = [];
  for (let i = 1; i <= 5; i++) {
    const val = obj[String(i)];
    if (!val) continue;
    const circled = CIRCLED[i - 1];
    if (typeof val === 'string') {
      parts.push(`${circled} ${val}`);
    } else if (typeof val === 'object' && val !== null) {
      const entries = Object.entries(val as Record<string, string>);
      const body = entries.map(([k, v]) => `${k}: ${v}`).join(', ');
      parts.push(`${circled} ${body}`);
    }
  }
  return parts.join(' ### ');
}

async function main() {
  const args = process.argv.slice(2);
  const ids = args.includes('--all-38')
    ? ALL_38_IDS
    : args.map((s) => s.trim()).filter(Boolean);

  if (ids.length === 0) {
    console.error('사용법: npx tsx scripts/fix-paragraph-and-options.ts --all-38  또는  <id> [id2 ...]');
    process.exit(1);
  }

  const db = await getDb('gomijoshua');
  const gqCol = db.collection('generated_questions');
  const passageCol = db.collection('passages');

  const passageCache: Record<string, string> = {};

  async function getOriginalText(passage_id: string): Promise<string> {
    if (passageCache[passage_id]) return passageCache[passage_id];
    const p = await passageCol.findOne({ _id: new ObjectId(passage_id) });
    const text: string = (p?.content?.original as string) ?? '';
    passageCache[passage_id] = text;
    return text;
  }

  for (const id of ids) {
    const doc = await gqCol.findOne({ _id: new ObjectId(id) });
    if (!doc) {
      console.log(JSON.stringify({ id, error: '문항 없음' }));
      continue;
    }

    const qd = (doc.question_data ?? {}) as Record<string, unknown>;
    const type: string = String(doc.type ?? '').trim();
    const passageId: string = String(doc.passage_id ?? '');

    const hasParagraph = 'Paragraph' in qd && String(qd.Paragraph ?? '').trim().length > 0;
    const $set: Record<string, unknown> = {};
    const $unset: Record<string, unknown> = {};

    // Paragraph 설정
    if (!hasParagraph) {
      if (type === '어법') {
        const pw = String(qd.PassageWithUnderlines ?? '').trim();
        if (pw) {
          $set['question_data.Paragraph'] = pw;
          $unset['question_data.PassageWithUnderlines'] = '';
        } else {
          console.log(JSON.stringify({ id, type, warn: 'PassageWithUnderlines 없음' }));
        }
      } else if (type === '빈칸') {
        const pb = String(qd.PassageWithBlank ?? '').trim();
        if (pb) {
          $set['question_data.Paragraph'] = pb;
          $unset['question_data.PassageWithBlank'] = '';
        } else {
          console.log(JSON.stringify({ id, type, warn: 'PassageWithBlank 없음' }));
        }
      } else if (type === '삽입' || type === '삽입-고난도') {
        const insertSent = String(qd.InsertSentence ?? '').trim();
        const passagePos = String(qd.PassageWithPositions ?? '').trim();
        if (insertSent && passagePos) {
          $set['question_data.Paragraph'] = `${insertSent}\n\n${passagePos}`;
          $unset['question_data.InsertSentence'] = '';
          $unset['question_data.PassageWithPositions'] = '';
        } else {
          console.log(JSON.stringify({ id, type, warn: `InsertSentence=${!!insertSent} PassageWithPositions=${!!passagePos}` }));
        }
      } else if (type === '함의') {
        const q = String(qd.Question ?? '');
        const clause = extractImpliedClause(q);
        if (clause && passageId) {
          const original = await getOriginalText(passageId);
          const paragraph = applyUnderline(original, clause);
          $set['question_data.Paragraph'] = paragraph;
          if (paragraph === original) {
            console.log(JSON.stringify({ id, type, warn: `함의 구절 매칭 실패: '${clause.slice(0, 50)}...'` }));
          }
        } else {
          console.log(JSON.stringify({ id, type, warn: `함의 구절 추출 실패 또는 passage_id 없음` }));
        }
      } else if (['주제','제목','주장','일치','불일치','순서','요약'].includes(type)) {
        if (passageId) {
          const original = await getOriginalText(passageId);
          if (original) $set['question_data.Paragraph'] = original;
          else console.log(JSON.stringify({ id, type, warn: 'passage 원문 없음' }));
        } else {
          console.log(JSON.stringify({ id, type, warn: 'passage_id 없음' }));
        }
      }
    }

    // Options 형식 수정 (객체 → 문자열)
    const opts = qd.Options;
    if (opts && typeof opts === 'object' && !Array.isArray(opts)) {
      const str = optionsObjectToString(opts);
      if (str) $set['question_data.Options'] = str;
    }

    // QuestionType 불필요 필드 제거
    if ('QuestionType' in qd) $unset['question_data.QuestionType'] = '';
    // AnswerExplanation 정리 (Explanation 이미 있으면)
    if ('AnswerExplanation' in qd && 'Explanation' in qd) {
      $unset['question_data.AnswerExplanation'] = '';
    }

    const updateOp: Record<string, unknown> = {};
    if (Object.keys($set).length > 0) {
      $set['updated_at'] = new Date();
      updateOp['$set'] = $set;
    }
    if (Object.keys($unset).length > 0) updateOp['$unset'] = $unset;

    if (Object.keys(updateOp).length === 0) {
      console.log(JSON.stringify({ id, type, skipped: '변경 없음' }));
      continue;
    }

    const r = await gqCol.updateOne({ _id: new ObjectId(id) }, updateOp);
    const paragraphSet = '$set' in updateOp && 'question_data.Paragraph' in ($set as Record<string, unknown>);
    console.log(JSON.stringify({
      id, type,
      paragraphSet,
      optionsConverted: '$set' in updateOp && 'question_data.Options' in ($set as Record<string, unknown>),
      modified: r.modifiedCount === 1,
    }));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
