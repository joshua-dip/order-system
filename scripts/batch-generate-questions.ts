/**
 * BV 주문의 빈칸/순서/삽입 문제를 배치 생성합니다.
 * Pro만 사용 — 외부 API 호출 없이 텍스트 처리만으로 문제를 구성합니다.
 *
 * 사용법:
 *   npx tsx scripts/batch-generate-questions.ts --order BV-20260408-002 [--dry-run] [--types 빈칸,순서,삽입]
 *   npx tsx scripts/batch-generate-questions.ts --order BV-... --difficulty 상 --types 삽입
 */
import { ObjectId } from 'mongodb';
import { getDb } from '../lib/mongodb';
import { buildHardInsertionQuestionData } from '../lib/hard-insertion-generator';

/* ── CLI args ── */
const args = process.argv.slice(2);
function arg(name: string): string | undefined {
  const i = args.indexOf('--' + name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}
const dryRun = args.includes('--dry-run');
const orderNumber = arg('order') ?? '';
const typesArg = arg('types')?.split(',') ?? ['빈칸', '순서', '삽입'];
const requiredPerType = Number(arg('required') || '2');
const difficultyArg = arg('difficulty') ?? '중';

if (!orderNumber) {
  console.error('사용법: npx tsx scripts/batch-generate-questions.ts --order BV-20260408-002 [--dry-run] [--difficulty 상]');
  process.exit(1);
}

/* ── 문장 분리 ── */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/* ── 순서 문제 생성 ── */
type QData = Record<string, unknown>;

function generateOrderQuestion(
  sentences: string[],
  source: string,
  version: number,
): QData | null {
  if (sentences.length < 5) return null;

  let introCount: number;
  let groupSizes: number[];

  if (version === 1) {
    introCount = Math.min(2, Math.floor(sentences.length * 0.25));
    if (introCount < 1) introCount = 1;
    const rest = sentences.length - introCount;
    const base = Math.floor(rest / 3);
    const rem = rest % 3;
    groupSizes = [base + (rem > 0 ? 1 : 0), base + (rem > 1 ? 1 : 0), base];
  } else {
    introCount = 1;
    const rest = sentences.length - introCount;
    const base = Math.floor(rest / 3);
    const rem = rest % 3;
    groupSizes = [base, base + (rem > 0 ? 1 : 0), base + (rem > 1 ? 1 : 0)];
  }

  const intro = sentences.slice(0, introCount).join(' ');
  let idx = introCount;
  const groups: string[] = [];
  const labels = ['A', 'B', 'C'];
  for (const sz of groupSizes) {
    groups.push(sentences.slice(idx, idx + sz).join(' '));
    idx += sz;
  }

  const orderOptions = [
    '(A)-(C)-(B)',
    '(B)-(A)-(C)',
    '(B)-(C)-(A)',
    '(C)-(A)-(B)',
    '(C)-(B)-(A)',
  ];

  const correctOrder = '(A)-(B)-(C)';
  let correctIdx = orderOptions.indexOf(correctOrder);
  if (correctIdx < 0) {
    orderOptions[4] = correctOrder;
    correctIdx = 4;
  }
  if (!orderOptions.includes(correctOrder)) {
    orderOptions.push(correctOrder);
    correctIdx = orderOptions.length - 1;
  }

  const circled = ['①', '②', '③', '④', '⑤'];
  const options = orderOptions.map((o, i) => `${circled[i]} ${o}`).join('\n');

  const paragraph = [
    intro,
    '###',
    `(A) ${groups[0]}`,
    '###',
    `(B) ${groups[1]}`,
    '###',
    `(C) ${groups[2]}`,
  ].join('\n');

  const correctCircle = circled[correctIdx];

  const explanation = [
    `${correctCircle} 가 정답입니다.`,
    '',
    `주어진 글에서 ${intro.slice(0, 40)}...로 시작한 후,`,
    `(A)에서 "${groups[0].slice(0, 50)}..."로 이어지고,`,
    `(B)에서 "${groups[1].slice(0, 50)}..."가 전개되며,`,
    `(C)에서 "${groups[2].slice(0, 50)}..."로 마무리됩니다.`,
    `원문의 논리적 흐름에 따라 (A)-(B)-(C) 순서가 가장 자연스럽습니다.`,
  ].join('\n');

  return {
    순서: version,
    Source: source,
    Category: '순서',
    Question: '주어진 글 다음에 이어질 글의 순서로 가장 적절한 것을 고르시오.',
    Paragraph: paragraph,
    Options: options,
    OptionType: 'English',
    CorrectAnswer: correctCircle,
    Explanation: explanation,
  };
}

/* ── 삽입 문제 생성 ── */
function generateInsertQuestion(
  sentences: string[],
  source: string,
  version: number,
): QData | null {
  if (sentences.length < 5) return null;

  const candidates = sentences.slice(1, sentences.length - 1);
  if (candidates.length < 3) return null;

  let extractIdx: number;
  if (version === 1) {
    extractIdx = Math.floor(candidates.length * 0.4) + 1;
  } else {
    extractIdx = Math.floor(candidates.length * 0.7) + 1;
  }
  if (extractIdx >= sentences.length - 1) extractIdx = sentences.length - 2;
  if (extractIdx < 1) extractIdx = 1;

  const extractedSentence = sentences[extractIdx];
  const remaining = sentences.filter((_, i) => i !== extractIdx);

  const circled = ['①', '②', '③', '④', '⑤'];
  let markerCount = 0;
  const markedParts: string[] = [];

  for (let i = 0; i < remaining.length; i++) {
    if (i > 0 && markerCount < 5) {
      markedParts.push(circled[markerCount]);
      markerCount++;
    }
    markedParts.push(remaining[i]);
  }
  if (markerCount < 5) {
    markedParts.push(circled[markerCount]);
    markerCount++;
  }

  let correctPosition: number;
  if (extractIdx <= remaining.length) {
    correctPosition = extractIdx;
  } else {
    correctPosition = remaining.length;
  }
  if (correctPosition < 1) correctPosition = 1;
  if (correctPosition > 5) correctPosition = 5;

  const correctCircle = circled[correctPosition - 1];

  const paragraph = [
    extractedSentence,
    '###',
    markedParts.join(' '),
  ].join('\n');

  const options = circled.map((c) => `${c} `).join('\n');

  const explanation = [
    `${correctCircle} 가 정답입니다.`,
    '',
    `주어진 문장 "${extractedSentence.slice(0, 60)}..."는`,
    `${correctCircle} 위치에 삽입되었을 때 앞뒤 문맥과 자연스럽게 연결됩니다.`,
    correctPosition > 1
      ? `앞 문장에서의 내용 전개가 주어진 문장의 내용으로 이어지고,`
      : '',
    correctPosition < 5
      ? `뒤 문장과도 논리적으로 연결되어 글의 흐름이 자연스럽습니다.`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    순서: version,
    Source: source,
    Category: '삽입',
    Question: '글의 흐름으로 보아, 주어진 문장이 들어가기에 가장 적절한 곳을 고르시오.',
    Paragraph: paragraph,
    Options: options,
    OptionType: 'English',
    CorrectAnswer: correctCircle,
    Explanation: explanation,
  };
}

/* ── 빈칸 문제 생성 ── */
function findKeyPhrase(sentences: string[], version: number): { sentIdx: number; phrase: string; start: number; end: number } | null {
  const scoreSentence = (s: string, idx: number): number => {
    let score = 0;
    if (/\b(therefore|thus|hence|consequently|as a result)\b/i.test(s)) score += 3;
    if (/\b(important|essential|crucial|significant|key|main|fundamental)\b/i.test(s)) score += 2;
    if (/\b(however|but|rather|instead|on the contrary)\b/i.test(s)) score += 2;
    if (/\b(should|must|need to|would|could)\b/i.test(s)) score += 1;
    if (idx >= sentences.length - 2) score += 1;
    if (idx > 0 && idx < sentences.length - 1) score += 1;
    if (s.length > 60) score += 1;
    return score;
  };

  const scored = sentences.map((s, i) => ({ s, i, score: scoreSentence(s, i) }));
  scored.sort((a, b) => b.score - a.score);

  const targetIdx = version === 1 ? 0 : Math.min(1, scored.length - 1);
  const target = scored[targetIdx];
  if (!target) return null;

  const sent = target.s;
  const phrases: { phrase: string; start: number; end: number; score: number }[] = [];

  const patterns = [
    /\b(\w+(?:\s+\w+){2,5})\s*$/,
    /\b((?:the|a|an)\s+\w+(?:\s+\w+){1,4})/gi,
    /\b(\w+(?:\s+\w+){1,3})\s*(?=[,.])/g,
  ];

  for (const pat of patterns) {
    let m: RegExpExecArray | null;
    const regex = new RegExp(pat.source, pat.flags);
    while ((m = regex.exec(sent)) !== null) {
      const phrase = m[1] || m[0];
      if (phrase.length >= 10 && phrase.length <= 80 && phrase.split(/\s+/).length >= 2) {
        let pscore = phrase.split(/\s+/).length;
        if (/\b(not|never|no)\b/i.test(phrase)) pscore -= 1;
        phrases.push({ phrase, start: m.index, end: m.index + phrase.length, score: pscore });
      }
    }
  }

  if (phrases.length === 0) {
    const words = sent.split(/\s+/);
    if (words.length >= 4) {
      const mid = Math.floor(words.length / 2);
      const phr = words.slice(mid - 1, mid + 2).join(' ');
      const idx = sent.indexOf(phr);
      if (idx >= 0) {
        phrases.push({ phrase: phr, start: idx, end: idx + phr.length, score: 1 });
      }
    }
  }

  if (phrases.length === 0) return null;

  phrases.sort((a, b) => b.score - a.score);
  return { sentIdx: target.i, phrase: phrases[0].phrase, start: phrases[0].start, end: phrases[0].end };
}

function generateDistractors(correctPhrase: string, passageText: string): string[] {
  const distractorPool = [
    'a more structured approach',
    'an alternative perspective',
    'a comprehensive evaluation',
    'a systematic methodology',
    'the underlying assumptions',
    'the fundamental principles',
    'an effective communication strategy',
    'a collaborative decision-making process',
    'the established social norms',
    'an innovative problem-solving technique',
    'the conventional wisdom',
    'a balanced combination of elements',
    "the individual's personal growth",
    'a deeper understanding of context',
    'the overall impact on society',
    'a gradual shift in perspective',
    'the essential components of success',
    'a meaningful connection between ideas',
    'the potential for future development',
    'a significant cultural transformation',
    'the inherent value of diversity',
    'a practical application of theory',
    'the shared responsibility of members',
    'a clear distinction between concepts',
    'the continuous pursuit of excellence',
    'a sustainable approach to challenges',
    'a critical examination of evidence',
    'the mutual benefit of cooperation',
    'a reliable source of information',
    'the ability to adapt to change',
  ];

  const correctWords = new Set(correctPhrase.toLowerCase().split(/\s+/));
  const filtered = distractorPool.filter((d) => {
    const dWords = d.toLowerCase().split(/\s+/);
    const overlap = dWords.filter((w) => correctWords.has(w)).length;
    return overlap <= 1;
  });

  const shuffled = filtered.sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 4);
}

function generateBlankQuestion(
  sentences: string[],
  fullText: string,
  source: string,
  version: number,
): QData | null {
  const kp = findKeyPhrase(sentences, version);
  if (!kp) return null;

  const blankedSentence =
    sentences[kp.sentIdx].slice(0, kp.start) +
    '<u>__________________</u>' +
    sentences[kp.sentIdx].slice(kp.end);

  const paragraph = sentences.map((s, i) => (i === kp.sentIdx ? blankedSentence : s)).join(' ');

  const distractors = generateDistractors(kp.phrase, fullText);
  const allOptions = [...distractors];
  const correctPos = Math.floor(Math.random() * 5);
  allOptions.splice(correctPos, 0, kp.phrase);
  if (allOptions.length > 5) allOptions.length = 5;

  const circled = ['①', '②', '③', '④', '⑤'];
  const options = allOptions.map((o, i) => `${circled[i]} ${o}`).join('\n');
  const correctCircle = circled[correctPos];

  const explanation = [
    `${correctCircle} ${kp.phrase}`,
    '',
    `*해설: 빈칸이 포함된 문장의 문맥을 살펴보면, "${sentences[kp.sentIdx].slice(0, 80)}..."에서`,
    `빈칸에는 '${kp.phrase}'가 들어가는 것이 가장 적절합니다.`,
    `글의 전체적인 흐름과 앞뒤 문맥을 고려할 때 이 표현이 논리적으로 연결됩니다.`,
  ].join('\n');

  return {
    순서: version,
    Source: source,
    Category: '빈칸',
    Question: '다음 글의 빈칸에 들어갈 말로 가장 적절한 것은?',
    Paragraph: paragraph,
    Options: options,
    OptionType: 'English',
    CorrectAnswer: correctCircle,
    Explanation: explanation,
  };
}

/* ── 메인 ── */
async function main() {
  const db = await getDb('gomijoshua');

  const order = await db.collection('orders').findOne({ orderNumber });
  if (!order) {
    console.error(`주문 ${orderNumber}을 찾을 수 없습니다.`);
    process.exit(1);
  }

  const meta = (order as any).orderMeta ?? {};
  const textbook = String(meta.selectedTextbook ?? meta.textbook ?? '');
  const lessonKeys: string[] = meta.selectedLessons ?? [];
  console.log(`교재: ${textbook}`);
  console.log(`요청 지문: ${lessonKeys.length}개`);

  let passageFilter: Record<string, unknown>;
  if (lessonKeys.length > 0) {
    passageFilter = {
      $or: lessonKeys.map((l) => {
        const parts = l.split(' ');
        return parts.length >= 2
          ? { textbook, chapter: parts[0], number: parts.slice(1).join(' ') }
          : { textbook, number: l };
      }),
    };
  } else {
    passageFilter = { textbook };
  }

  const passages = await db
    .collection('passages')
    .find(passageFilter)
    .project({ _id: 1, chapter: 1, number: 1, source_key: 1, content: 1, order: 1 })
    .sort({ chapter: 1, order: 1, number: 1 })
    .toArray();

  console.log(`DB 지문: ${passages.length}개 (주문 ${lessonKeys.length}개 요청)`);

  const existing = await db
    .collection('generated_questions')
    .find({
      textbook,
      type: { $in: typesArg },
    })
    .project({ passage_id: 1, type: 1 })
    .toArray();

  const existingMap = new Map<string, Set<string>>();
  for (const e of existing) {
    const pid = String(e.passage_id);
    if (!existingMap.has(pid)) existingMap.set(pid, new Set());
    existingMap.get(pid)!.add(e.type);
  }

  let totalGenerated = 0;
  let totalSkipped = 0;

  for (const p of passages) {
    const pid = String(p._id);
    const source = `${p.chapter ?? ''} ${p.number ?? ''}`.trim();
    const rawContent = p.content;
    const content = typeof rawContent === 'string'
      ? rawContent
      : typeof rawContent === 'object' && rawContent && 'original' in rawContent
        ? String((rawContent as any).original ?? '')
        : '';

    if (!content || content.length < 100) {
      console.log(`  [SKIP] ${source}: 지문 너무 짧음 (${content.length}자)`);
      totalSkipped++;
      continue;
    }

    const sentences = splitSentences(content);
    if (sentences.length < 5) {
      console.log(`  [SKIP] ${source}: 문장 부족 (${sentences.length}개)`);
      totalSkipped++;
      continue;
    }

    for (const qType of typesArg) {
      const existingCount = await db
        .collection('generated_questions')
        .countDocuments({
          passage_id: new ObjectId(pid),
          type: qType,
          ...(difficultyArg !== '중' ? { difficulty: difficultyArg } : {}),
        });

      const needed = requiredPerType - existingCount;
      if (needed <= 0) {
        continue;
      }

      for (let v = 1; v <= needed; v++) {
        let qd: QData | null = null;

        if (qType === '순서') {
          qd = generateOrderQuestion(sentences, source, v);
        } else if (qType === '삽입') {
          if (difficultyArg === '상') {
            qd = buildHardInsertionQuestionData(sentences, source, v);
          } else {
            qd = generateInsertQuestion(sentences, source, v);
          }
        } else if (qType === '빈칸') {
          qd = generateBlankQuestion(sentences, content, source, v);
        }

        if (!qd) {
          console.log(`  [FAIL] ${source} ${qType} v${v}: 생성 실패`);
          continue;
        }

        if (dryRun) {
          console.log(`  [DRY] ${source} ${qType} v${v}: OK`);
          totalGenerated++;
          continue;
        }

        const doc = {
          textbook,
          passage_id: new ObjectId(pid),
          source,
          type: qType,
          option_type: 'English',
          difficulty: difficultyArg,
          question_data: qd,
          status: '대기',
          error_msg: null,
          created_at: new Date(),
          updated_at: new Date(),
        };

        const r = await db.collection('generated_questions').insertOne(doc);
        console.log(`  [SAVED] ${source} ${qType} v${v}: ${r.insertedId}`);
        totalGenerated++;
      }
    }
  }

  console.log(`\n완료: ${totalGenerated}개 생성, ${totalSkipped}개 스킵`);
  if (dryRun) console.log('(dry-run 모드 — 실제 저장하지 않음)');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
