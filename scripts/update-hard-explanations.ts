import { getDb } from '../lib/mongodb';

const circled = ['①', '②', '③', '④', '⑤'];

function extractDemonstrative(sentence: string): string {
  const patterns = [
    /\b(this|these|those|such|that)\s+\w+/i,
    /\b(however|therefore|consequently|as a result|in other words|thus|moreover|furthermore|nevertheless|in contrast|for this reason)\b/i,
  ];
  for (const p of patterns) {
    const m = sentence.match(p);
    if (m) return m[0];
  }
  return 'this';
}

function parseParagraph(paragraphRaw: string) {
  const parts = paragraphRaw.split('###');
  if (parts.length < 2) return null;

  const generatedSentence = parts[0].replace(/<[^>]+>/g, '').trim();
  const passageWithMarkers = parts.slice(1).join('').trim();

  const sentences = passageWithMarkers
    .split(/[①②③④⑤]/)
    .map((s) => s.replace(/<[^>]+>/g, '').trim())
    .filter((s) => s.length > 0);

  return { generatedSentence, sentences };
}

function findInsertionPosition(correctAnswer: string): number {
  const idx = circled.indexOf(correctAnswer.trim());
  return idx >= 0 ? idx + 1 : -1;
}

function buildNewExplanation(
  correctAnswer: string,
  generatedSentence: string,
  sentences: string[],
  position: number,
): string {
  const c = correctAnswer.trim();
  const demo = extractDemonstrative(generatedSentence);
  const prevSent = sentences[position - 1] ?? '';
  const nextSent = sentences[position] ?? '';

  const prevSnippet = prevSent.length > 70 ? prevSent.slice(0, 70) + '…' : prevSent;
  const nextSnippet = nextSent.length > 70 ? nextSent.slice(0, 70) + '…' : nextSent;

  return [
    `${c}이 정답입니다.`,
    `${c} 바로 앞 문장에서 "${prevSnippet}"라고 서술하고 있는데,`,
    `주어진 문장의 '${demo}'가 이 내용을 직접적으로 받아 부연·정리하고 있습니다.`,
    `삽입된 문장 뒤에 이어지는 "${nextSnippet}"는`,
    `주어진 문장이 제시한 관점을 바탕으로 논의를 확장하므로 글의 흐름이 자연스럽게 이어집니다.`,
  ].join(' ');
}

async function main() {
  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');

  const docs = await col
    .find({ type: '삽입', difficulty: '상' })
    .toArray();

  console.log(`삽입/상 문제 총 ${docs.length}건 발견`);

  let updated = 0;
  let skipped = 0;

  for (const doc of docs) {
    const qd = doc.question_data as Record<string, unknown> | undefined;
    if (!qd) { skipped++; continue; }

    const paragraphRaw = String(qd.Paragraph ?? qd.paragraph ?? '');
    const correctAnswer = String(qd.CorrectAnswer ?? qd.correctAnswer ?? '');

    const parsed = parseParagraph(paragraphRaw);
    if (!parsed) {
      console.log(`  SKIP (parse fail): ${doc.source}`);
      skipped++;
      continue;
    }

    const position = findInsertionPosition(correctAnswer);
    if (position < 1) {
      console.log(`  SKIP (answer parse): ${doc.source} → ${correctAnswer}`);
      skipped++;
      continue;
    }

    const { generatedSentence, sentences } = parsed;

    if (position > sentences.length) {
      console.log(`  SKIP (pos ${position} > ${sentences.length} sents): ${doc.source}`);
      skipped++;
      continue;
    }

    const newExplanation = buildNewExplanation(
      correctAnswer,
      generatedSentence,
      sentences,
      position,
    );

    await col.updateOne(
      { _id: doc._id },
      { $set: { 'question_data.Explanation': newExplanation } },
    );

    updated++;
  }

  console.log(`\n완료: ${updated}건 업데이트, ${skipped}건 스킵`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
