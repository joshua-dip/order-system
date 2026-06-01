/**
 * 「요약」 변형문제 Paragraph 구조 점검.
 *
 *   - 표준: 원문 본문 → 빈 줄 → 요약문 `(A) ____ ... (B) ____` (요약문이 **하단**)
 *   - 비표준 A: 요약문이 본문 **위**에 위치 — Paragraph 첫 30% 안에 `(A)` 등장
 *   - 비표준 B: 요약문이 **누락** — Paragraph 안에 `(A)·(B)` 둘 다 없음
 *
 * 사용:
 *   npx tsx scripts/audit-summary-paragraph-order.ts [--textbook "..."] [--inspect <id>]
 */
import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env') });
config({ path: path.join(__dirname, '..', '.env.local') });

import { getDb } from '../lib/mongodb';
import { ObjectId } from 'mongodb';

const TEXTBOOK_DEFAULT = '2027수능특강 영어(2026)';

function parseArg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return String(process.argv[i + 1]);
  return fallback;
}

type Hit = {
  id: string;
  source: string;
  status: string;
  difficulty: string;
  firstAIndex: number;
  firstBIndex: number;
  paragraphLen: number;
  head: string;
};

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
    status: d.status,
    difficulty: d.difficulty,
    Question: qd.Question,
    Paragraph: qd.Paragraph,
    Options: qd.Options,
    CorrectAnswer: qd.CorrectAnswer,
    Explanation: qd.Explanation,
  }, null, 2));
}

async function main() {
  const inspectId = parseArg('inspect', '');
  if (inspectId) {
    await inspectOne(inspectId);
    process.exit(0);
  }

  const textbook = parseArg('textbook', TEXTBOOK_DEFAULT);
  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');

  const docs = await col
    .find({ textbook, type: '요약' })
    .project({ _id: 1, source: 1, status: 1, difficulty: 1, 'question_data.Paragraph': 1, 'question_data.Question': 1, 'question_data.Options': 1 })
    .toArray();

  console.log(`교재: "${textbook}" / 요약 문항 총 ${docs.length}건`);

  const hits: Hit[] = [];
  let noParagraph = 0;
  const missingSummary: typeof docs = [];
  let summaryInQuestion = 0;
  let summaryInOptionsOnly = 0;

  for (const d of docs) {
    const qd = (d.question_data ?? {}) as Record<string, unknown>;
    const para = String(qd.Paragraph ?? '');
    const question = String(qd.Question ?? '');
    const options = String(qd.Options ?? '');
    if (!para.trim()) {
      noParagraph += 1;
      continue;
    }
    const idxA = para.indexOf('(A)');
    const idxB = para.indexOf('(B)');
    if (idxA < 0 && idxB < 0) {
      missingSummary.push(d);
      const inQ = question.includes('(A)') || question.includes('(B)');
      if (inQ) summaryInQuestion += 1;
      else if (options.includes('(A)')) summaryInOptionsOnly += 1;
      continue;
    }
    const first = Math.min(
      idxA >= 0 ? idxA : Number.POSITIVE_INFINITY,
      idxB >= 0 ? idxB : Number.POSITIVE_INFINITY,
    );
    const ratio = first / para.length;
    if (ratio < 0.3) {
      hits.push({
        id: String(d._id),
        source: String(d.source ?? ''),
        status: String(d.status ?? ''),
        difficulty: String(d.difficulty ?? ''),
        firstAIndex: idxA,
        firstBIndex: idxB,
        paragraphLen: para.length,
        head: para.slice(0, 240).replace(/\s+/g, ' '),
      });
    }
  }

  console.log(`Paragraph 없음: ${noParagraph}`);
  console.log(`Paragraph 안에서 요약문이 본문 위에 위치한 경우: ${hits.length}`);
  console.log(`Paragraph 에 (A)·(B) 둘 다 없는 경우: ${missingSummary.length}`);
  console.log(`  └ Question 필드 안에 요약문이 들어 있는 경우(렌더링 시 본문 위 표시): ${summaryInQuestion}`);
  console.log(`  └ Options 안에만 있는 경우: ${summaryInOptionsOnly}`);
  console.log('');

  if (missingSummary.length > 0) {
    console.log('▼▼ 요약문이 Question 필드(또는 그 외)에 들어가 본문 위에 표시되는 케이스 ▼▼');
    for (const d of missingSummary) {
      console.log(`  • id=${String(d._id)}  source="${d.source}"  status=${d.status}`);
    }
  }
  console.log('');

  if (hits.length === 0) {
    console.log('— 「요약문이 본문 위」 패턴의 문항은 발견되지 않았습니다.');
  } else {
    for (const h of hits) {
      console.log('─'.repeat(80));
      console.log(`id=${h.id}  source="${h.source}"  status=${h.status}  diff=${h.difficulty}`);
      console.log(`머리(240자): ${h.head}`);
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('FAIL', err);
  process.exit(1);
});
