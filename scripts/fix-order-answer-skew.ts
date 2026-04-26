/**
 * 순서 문제 정답 편중 해소 — 라운드별 재라벨링
 *
 * 기존 원본 문항(순서 1,2)의 (A)(B)(C) 단락을 재라벨링하여
 * ①~④ 답이 고르게 분포되는 새 문항을 추가.
 *
 * Usage:
 *   npx tsx scripts/fix-order-answer-skew.ts --round 1 --dry-run   # 라운드1 검증
 *   npx tsx scripts/fix-order-answer-skew.ts --round 1              # 라운드1 삽입 (순서 3,4)
 *   npx tsx scripts/fix-order-answer-skew.ts --round 2 --dry-run   # 라운드2 검증
 *   npx tsx scripts/fix-order-answer-skew.ts --round 2              # 라운드2 삽입 (순서 5,6)
 */

import path from 'path';
import { config } from 'dotenv';
import { ObjectId } from 'mongodb';

const PROJECT_ROOT = path.resolve(__dirname, '..');
config({ path: path.join(PROJECT_ROOT, '.env') });
config({ path: path.join(PROJECT_ROOT, '.env.local') });

import { getDb } from '../lib/mongodb';

const TEXTBOOK = '수능만만 영어독해 20회';
const SOURCE_RE = /^(01회|02회|03회)/;

const CIRCLED = ['①', '②', '③', '④', '⑤'] as const;
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
const STANDARD_OPTIONS = CIRCLED.map((c, i) => `${c} ${Object.values(ORDER_TEXT)[i]}`).join('\n');

/* ─── Paragraph 파싱 ─── */

interface ParsedParagraph {
  intro: string;
  A: string;
  B: string;
  C: string;
  sep: string;
}

function parseParagraph(raw: string): ParsedParagraph | null {
  const re1 = /^([\s\S]+?)\n###\n\(A\)\s*([\s\S]+?)\n###\n\(B\)\s*([\s\S]+?)\n###\n\(C\)\s*([\s\S]+)$/;
  const m1 = raw.match(re1);
  if (m1) return { intro: m1[1].trim(), A: m1[2].trim(), B: m1[3].trim(), C: m1[4].trim(), sep: '\n###\n' };

  const re2 = /^([\s\S]+?)\n\n\(A\)\s*([\s\S]+?)\n\n\(B\)\s*([\s\S]+?)\n\n\(C\)\s*([\s\S]+)$/;
  const m2 = raw.match(re2);
  if (m2) return { intro: m2[1].trim(), A: m2[2].trim(), B: m2[3].trim(), C: m2[4].trim(), sep: '\n\n' };

  return null;
}

function relabel(p: ParsedParagraph, target: string): string {
  const order = ORDER_LABELS[target];
  if (!order) throw new Error(`invalid target: ${target}`);
  const texts = [p.A, p.B, p.C];
  const labelToText: Record<string, string> = {};
  for (let i = 0; i < 3; i++) labelToText[order[i]] = texts[i];
  return [p.intro, `(A) ${labelToText['A']}`, `(B) ${labelToText['B']}`, `(C) ${labelToText['C']}`].join(p.sep);
}

function excerpt(text: string, len = 45): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= len ? clean : clean.slice(0, len) + '...';
}

function buildExplanation(
  answer: string,
  intro: string,
  parts: Pick<ParsedParagraph, 'A' | 'B' | 'C'>,
): string {
  const order = ORDER_LABELS[answer];
  if (!order) return `${answer} 가 정답입니다.`;
  const [first, second, third] = order;
  const ex = (k: 'A' | 'B' | 'C') => excerpt(parts[k]);
  return [
    `${answer} 가 정답입니다.`,
    ``,
    `주어진 글에서 ${excerpt(intro)}로 시작한 후,`,
    `(${first})에서 "${ex(first as 'A' | 'B' | 'C')}"로 이어지고,`,
    `(${second})에서 "${ex(second as 'A' | 'B' | 'C')}"가 전개되며,`,
    `(${third})에서 "${ex(third as 'A' | 'B' | 'C')}"로 마무리됩니다.`,
    `따라서 ${ORDER_TEXT[answer]} 순서가 가장 자연스럽다.`,
  ].join('\n');
}

/* ─── main ─── */

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const roundIdx = process.argv.indexOf('--round');
  const round = roundIdx >= 0 ? parseInt(process.argv[roundIdx + 1] ?? '1', 10) : 1;
  if (round < 1 || round > 10) { console.error('--round 1~10'); process.exit(1); }

  const seqOffset = round * 2; // round 1 → +2 (순서 3,4), round 2 → +4 (순서 5,6)
  const targetOffset = (round - 1) * 2; // round 1 → 0 (①②③④), round 2 → 2 (③④①②)

  console.log(`라운드 ${round}: 순서 오프셋 +${seqOffset}, 정답 시작 오프셋 ${targetOffset}`);

  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');

  // 원본 문항 (순서 1,2)만 가져옴
  const docs = await col
    .find({
      textbook: TEXTBOOK,
      type: '순서',
      deleted_at: null,
      source: { $regex: SOURCE_RE },
      'question_data.순서': { $lte: 2 },
    })
    .project({ _id: 1, source: 1, passage_id: 1, option_type: 1, difficulty: 1, question_data: 1 })
    .sort({ source: 1, 'question_data.순서': 1 })
    .toArray();

  console.log(`원본 순서 문항: ${docs.length}건`);

  const targets = ['①', '②', '③', '④'];
  let tIdx = targetOffset;

  const newDocs: Record<string, unknown>[] = [];
  let skipCount = 0;

  for (const doc of docs) {
    const qd = doc.question_data as Record<string, unknown>;
    const paragraph = String(qd?.Paragraph ?? '');
    const parsed = parseParagraph(paragraph);
    if (!parsed) {
      console.warn(`  스킵: ${doc.source} (${doc._id}) — Paragraph 파싱 실패`);
      skipCount++;
      continue;
    }

    const target = targets[tIdx % targets.length]!;
    tIdx++;

    const newParagraph = relabel(parsed, target);
    const existingSeq = Number(qd?.순서 ?? 1);
    const newSeq = existingSeq + seqOffset;

    const explanation = buildExplanation(target, parsed.intro, {
      A: parsed.A, B: parsed.B, C: parsed.C,
      ...(() => {
        const order = ORDER_LABELS[target]!;
        const texts = [parsed.A, parsed.B, parsed.C];
        const m: Record<string, string> = {};
        for (let i = 0; i < 3; i++) m[order[i]] = texts[i];
        return {};
      })(),
    });

    // 재라벨링 후의 paragraph를 다시 파싱해서 올바른 (A)(B)(C) 텍스트로 해설 생성
    const reParsed = parseParagraph(newParagraph);
    const finalExplanation = reParsed
      ? buildExplanation(target, reParsed.intro, reParsed)
      : explanation;

    newDocs.push({
      textbook: TEXTBOOK,
      passage_id: new ObjectId(String(doc.passage_id)),
      source: doc.source,
      type: '순서',
      option_type: doc.option_type ?? 'English',
      question_data: {
        순서: newSeq,
        Source: qd.Source,
        NumQuestion: newSeq,
        Category: '순서',
        Question: '주어진 글 다음에 이어질 글의 순서로 가장 적절한 것을 고르시오.',
        Paragraph: newParagraph,
        Options: STANDARD_OPTIONS,
        OptionType: qd.OptionType ?? 'English',
        CorrectAnswer: target,
        Explanation: finalExplanation,
      },
      status: '완료',
      error_msg: null,
      difficulty: doc.difficulty ?? '중',
      created_at: new Date(),
      updated_at: new Date(),
      deleted_at: null,
    });
  }

  console.log(`\n생성: ${newDocs.length}건 / 스킵: ${skipCount}건`);

  const dist: Record<string, number> = { '①': 0, '②': 0, '③': 0, '④': 0 };
  for (const d of newDocs) {
    const ans = String((d.question_data as Record<string, unknown>)?.CorrectAnswer ?? '');
    if (ans in dist) dist[ans]++;
  }
  console.log('정답 분포:', dist);

  if (newDocs.length === 0) { console.log('생성할 문항 없음.'); process.exit(0); }

  if (dryRun) {
    console.log('\n--dry-run: 실제 저장하지 않습니다.\n');
    for (const d of newDocs.slice(0, 4)) {
      const qd = d.question_data as Record<string, unknown>;
      console.log(`=== ${d.source} / 정답 ${qd.CorrectAnswer} (순서 ${qd.순서}) ===`);
      console.log(String(qd.Explanation ?? ''));
      console.log('');
    }
    process.exit(0);
  }

  const result = await col.insertMany(newDocs);
  console.log(`\n✓ ${result.insertedCount}건 MongoDB 삽입 완료`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
