/**
 * 재라벨링 순서 문항(순서>=3)의 Explanation을 실제 해설지 형식으로 업데이트.
 *
 * 형식:
 *   ① 가 정답입니다.
 *
 *   주어진 글에서 [intro 앞 40자]...로 시작한 후,
 *   (A)에서 "[A텍스트 앞 40자]..."로 이어지고,
 *   (C)에서 "[C텍스트 앞 40자]..."가 전개되며,
 *   (B)에서 "[B텍스트 앞 40자]..."로 마무리됩니다.
 *   따라서 (A)-(C)-(B) 순서가 가장 자연스럽다.
 *
 * Usage:
 *   npx tsx scripts/fix-order-explanations.ts --dry-run
 *   npx tsx scripts/fix-order-explanations.ts
 */

import path from 'path';
import { config } from 'dotenv';

const PROJECT_ROOT = path.resolve(__dirname, '..');
config({ path: path.join(PROJECT_ROOT, '.env') });
config({ path: path.join(PROJECT_ROOT, '.env.local') });

import { ObjectId } from 'mongodb';
import { getDb } from '../lib/mongodb';

const TEXTBOOK = '수능만만 영어독해 20회';
const SOURCE_RE = /^(01회|02회|03회)/;

const ORDER_LABELS: Record<string, [string, string, string]> = {
  '①': ['A', 'C', 'B'],
  '②': ['B', 'A', 'C'],
  '③': ['B', 'C', 'A'],
  '④': ['C', 'A', 'B'],
  '⑤': ['C', 'B', 'A'],
};
const ORDER_TEXT: Record<string, string> = {
  '①': '(A)-(C)-(B)',
  '②': '(B)-(A)-(C)',
  '③': '(B)-(C)-(A)',
  '④': '(C)-(A)-(B)',
  '⑤': '(C)-(B)-(A)',
};

function excerpt(text: string, len = 45): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= len) return clean;
  return clean.slice(0, len) + '...';
}

interface ParsedParagraph {
  intro: string;
  A: string;
  B: string;
  C: string;
}

function parseParagraph(raw: string): ParsedParagraph | null {
  const re1 = /^([\s\S]+?)\n###\n\(A\)\s*([\s\S]+?)\n###\n\(B\)\s*([\s\S]+?)\n###\n\(C\)\s*([\s\S]+)$/;
  const m1 = raw.match(re1);
  if (m1) return { intro: m1[1].trim(), A: m1[2].trim(), B: m1[3].trim(), C: m1[4].trim() };

  const re2 = /^([\s\S]+?)\n\n\(A\)\s*([\s\S]+?)\n\n\(B\)\s*([\s\S]+?)\n\n\(C\)\s*([\s\S]+)$/;
  const m2 = raw.match(re2);
  if (m2) return { intro: m2[1].trim(), A: m2[2].trim(), B: m2[3].trim(), C: m2[4].trim() };

  return null;
}

function buildExplanation(
  answer: string,
  intro: string,
  parts: Pick<ParsedParagraph, 'A' | 'B' | 'C'>,
): string {
  const order = ORDER_LABELS[answer];
  if (!order) return `${answer} 가 정답입니다.`;

  const [first, second, third] = order;
  const orderLabel = ORDER_TEXT[answer];
  const ex = (k: 'A' | 'B' | 'C') => excerpt(parts[k]);

  const lines = [
    `${answer} 가 정답입니다.`,
    ``,
    `주어진 글에서 ${excerpt(intro)}로 시작한 후,`,
    `(${first})에서 "${ex(first as 'A' | 'B' | 'C')}"로 이어지고,`,
    `(${second})에서 "${ex(second as 'A' | 'B' | 'C')}"가 전개되며,`,
    `(${third})에서 "${ex(third as 'A' | 'B' | 'C')}"로 마무리됩니다.`,
    `따라서 ${orderLabel} 순서가 가장 자연스럽다.`,
  ];

  return lines.join('\n');
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');

  const docs = await col
    .find({
      textbook: TEXTBOOK,
      type: '순서',
      deleted_at: null,
      source: { $regex: SOURCE_RE },
      'question_data.순서': { $gte: 3 },
    })
    .project({
      _id: 1,
      source: 1,
      'question_data.CorrectAnswer': 1,
      'question_data.Paragraph': 1,
      'question_data.Explanation': 1,
    })
    .sort({ source: 1 })
    .toArray();

  console.log(`대상 문항: ${docs.length}건`);

  const updates: { id: ObjectId; explanation: string }[] = [];
  let skipCount = 0;

  for (const doc of docs) {
    const qd = doc.question_data as Record<string, unknown>;
    const answer = String(qd?.CorrectAnswer ?? '').trim();
    const paragraph = String(qd?.Paragraph ?? '');

    const parsed = parseParagraph(paragraph);
    if (!parsed) {
      console.warn(`  스킵: ${doc.source} (${doc._id}) — Paragraph 파싱 실패`);
      skipCount++;
      continue;
    }

    const explanation = buildExplanation(answer, parsed.intro, parsed);
    updates.push({ id: doc._id as ObjectId, explanation });
  }

  console.log(`업데이트 대상: ${updates.length}건 / 스킵: ${skipCount}건`);

  if (dryRun) {
    console.log('\n--dry-run: 실제 업데이트하지 않습니다.\n');
    for (const u of updates.slice(0, 4)) {
      const doc = docs.find(d => String(d._id) === String(u.id));
      console.log(`=== ${doc?.source} ===`);
      console.log(u.explanation);
      console.log('');
    }
    process.exit(0);
  }

  let updatedCount = 0;
  for (const u of updates) {
    const res = await col.updateOne(
      { _id: u.id },
      { $set: { 'question_data.Explanation': u.explanation, updated_at: new Date() } },
    );
    updatedCount += res.modifiedCount;
  }

  console.log(`\n✓ ${updatedCount}건 해설 업데이트 완료`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
