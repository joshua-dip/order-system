/**
 * 「빈칸」 변형문제 Paragraph 점검.
 *
 * 정상: Paragraph 안에 `<u>______...</u>` 또는 충분히 긴 밑줄 패턴(`____` 3개 이상)이 1개 존재.
 * 비정상:
 *   - Paragraph 에 빈칸 표시(밑줄·<u>·______) 자체가 없음 → 원문이 그대로 들어 있는 경우
 *
 * 사용:
 *   npx tsx scripts/audit-blank-without-underline.ts [--textbook "..."]  (생략 시 전체 교재)
 *   npx tsx scripts/audit-blank-without-underline.ts --inspect <id>
 */
import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env') });
config({ path: path.join(__dirname, '..', '.env.local') });

import { ObjectId } from 'mongodb';
import { getDb } from '../lib/mongodb';

function parseArg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return String(process.argv[i + 1]);
  return null;
}

async function inspectOne(id: string) {
  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');
  if (!ObjectId.isValid(id)) {
    console.log('invalid id');
    return;
  }
  const d = await col.findOne({ _id: new ObjectId(id) });
  if (!d) {
    console.log('not found');
    return;
  }
  const qd = (d.question_data ?? {}) as Record<string, unknown>;
  console.log(JSON.stringify({
    _id: String(d._id),
    textbook: d.textbook,
    source: d.source,
    type: d.type,
    status: d.status,
    Question: qd.Question,
    Paragraph: qd.Paragraph,
    Options: qd.Options,
    CorrectAnswer: qd.CorrectAnswer,
  }, null, 2));
}

/**
 * Paragraph 안에 빈칸 표시가 있는지 판정.
 *   - `<u>...</u>` 태그
 *   - 4글자 이상의 연속 underscore `____`
 *   - 4글자 이상의 연속 EM DASH 또는 보통 dash `————` / `----`
 */
function hasBlankMarker(para: string): boolean {
  if (/<u[^>]*>/i.test(para)) return true;
  if (/_{4,}/.test(para)) return true;
  if (/—{4,}/.test(para)) return true;
  if (/-{6,}/.test(para)) return true;
  return false;
}

async function main() {
  const inspectId = parseArg('inspect');
  if (inspectId) {
    await inspectOne(inspectId);
    process.exit(0);
  }

  const textbook = parseArg('textbook');
  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');

  const query: Record<string, unknown> = { type: '빈칸' };
  if (textbook) query.textbook = textbook;

  const docs = await col
    .find(query)
    .project({ _id: 1, textbook: 1, source: 1, status: 1, difficulty: 1, 'question_data.Paragraph': 1, 'question_data.Question': 1 })
    .toArray();

  console.log(`점검 범위: ${textbook ? `"${textbook}"` : '전체 교재'} / 빈칸 문항 총 ${docs.length}건`);

  let noParagraph = 0;
  let noBlankMarker = 0;
  const hits: { id: string; textbook: string; source: string; status: string; difficulty: string; len: number; tail: string }[] = [];

  for (const d of docs) {
    const qd = (d.question_data ?? {}) as Record<string, unknown>;
    const para = String(qd.Paragraph ?? '');
    if (!para.trim()) {
      noParagraph += 1;
      continue;
    }
    if (!hasBlankMarker(para)) {
      noBlankMarker += 1;
      hits.push({
        id: String(d._id),
        textbook: String(d.textbook ?? ''),
        source: String(d.source ?? ''),
        status: String(d.status ?? ''),
        difficulty: String(d.difficulty ?? ''),
        len: para.length,
        tail: para.slice(0, 160).replace(/\s+/g, ' '),
      });
    }
  }

  console.log(`Paragraph 없음: ${noParagraph}`);
  console.log(`Paragraph 안에 빈칸 표시(<u>·____·———— 등) 없음: ${noBlankMarker}`);
  console.log('');

  if (hits.length === 0) {
    console.log('— 모든 빈칸 문항이 Paragraph 안에 빈칸 표시를 포함하고 있습니다.');
  } else {
    // 교재별 그룹 카운트
    const byTextbook: Record<string, number> = {};
    for (const h of hits) byTextbook[h.textbook] = (byTextbook[h.textbook] ?? 0) + 1;
    console.log('▼▼ 교재별 합계 ▼▼');
    for (const [tb, n] of Object.entries(byTextbook).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${n.toString().padStart(4)} : ${tb}`);
    }
    console.log('');
    console.log('▼▼ 상세 목록 (최대 50건) ▼▼');
    for (const h of hits.slice(0, 50)) {
      console.log(`  • id=${h.id}  [${h.textbook}] "${h.source}"  status=${h.status}  diff=${h.difficulty}  len=${h.len}`);
      console.log(`    머리(160자): ${h.tail}`);
    }
    if (hits.length > 50) console.log(`  ... 외 ${hits.length - 50}건`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('FAIL', err);
  process.exit(1);
});
