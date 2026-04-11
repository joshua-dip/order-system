/**
 * 26년 3월 고1 영어모의고사 — 삽입 '상' 문제 지문당 2개 추가 생성
 * 제외: 25~28번, 43~45번
 */

import Anthropic from '@anthropic-ai/sdk';
import { ObjectId } from 'mongodb';
import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env') });
config({ path: path.join(__dirname, '..', '.env.local') });

import { getDb } from '../lib/mongodb';
import { saveGeneratedQuestionToDb } from '../lib/variant-save-generated-question';

const TEXTBOOK = '26년 3월 고1 영어모의고사';
const CLAUDE = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const CIRCLED = ['①', '②', '③', '④', '⑤'];

/** 지문에서 마커를 제거하고 문장 배열로 분리 */
function extractSentences(passageWithMarkers: string): string[] {
  return passageWithMarkers
    .replace(/[①②③④⑤]/g, '')
    .replace(/<[^>]+>/g, '')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10);
}

/** 기존 정답 위치 파싱 */
function parseAnswerPosition(correctAnswer: string): number {
  return CIRCLED.indexOf(correctAnswer.trim()) + 1; // 1-based
}

/** 사용 가능한 삽입 위치 후보 (이미 사용된 위치 제외, mid~late 선호) */
function pickPositions(totalSentences: number, usedPositions: number[]): number[] {
  const candidates: number[] = [];
  const start = Math.max(2, Math.floor(totalSentences * 0.3));
  const end = Math.min(totalSentences - 1, Math.floor(totalSentences * 0.85));
  for (let i = start; i <= end; i++) {
    if (!usedPositions.includes(i)) candidates.push(i);
  }
  // 부족하면 전체에서 추가
  if (candidates.length < 2) {
    for (let i = 2; i < totalSentences; i++) {
      if (!usedPositions.includes(i) && !candidates.includes(i)) candidates.push(i);
    }
  }
  return candidates.slice(0, 2);
}

/** 지문에 ①②③④⑤ 마커 삽입 */
function buildMarkedPassage(sentences: string[], insertPosition: number): string {
  const parts: string[] = [];
  for (let i = 0; i < sentences.length; i++) {
    if (i > 0 && i <= 5) parts.push(CIRCLED[i - 1]);
    parts.push(sentences[i]);
  }
  if (sentences.length <= 5) parts.push(CIRCLED[Math.min(sentences.length - 1, 4)]);
  return parts.join(' ');
}

/** Claude API로 삽입 문장 + 해설 생성 */
async function generateInsertionQuestion(
  sentences: string[],
  position: number,
): Promise<{ sentence: string; explanation: string } | null> {
  const prevSent = sentences[position - 1] ?? '';
  const nextSent = sentences[position] ?? '';
  const markedPassage = buildMarkedPassage(sentences, position);
  const correctCircle = CIRCLED[position - 1];

  const prompt = `
You are an expert at creating Korean English exam (수능) sentence insertion problems at difficulty level '상' (hard).

**Task**: Create ONE new bridge sentence that fits at position ${correctCircle} in the passage below.

**Passage with markers (${correctCircle} is the target insertion position)**:
${markedPassage}

**Rules for the generated sentence**:
1. It must be ENTIRELY NEW — no copying or paraphrasing from any existing passage sentence.
2. Must contain a demonstrative (this, such, these, that) or connector (however, therefore, consequently, as a result, in other words) that clearly points to the previous sentence's content.
3. Must summarize/elaborate on the sentence before ${correctCircle} and lead naturally into the sentence after ${correctCircle}.
4. Do NOT introduce new facts, names, or examples not in the passage.
5. Length: 15–35 words, exactly 1 sentence.
6. Include topic keywords so it looks plausible elsewhere, but the demonstrative only fits at ${correctCircle}.

**Then write a Korean explanation (해설)**:
- Start with "${correctCircle}이 정답입니다." (use 가 instead of 이 if the circle ends with a vowel sound)
- 글 전체 논리 흐름 요약 (2~3문장)
- 삽입 위치 근거: why the demonstrative points to the sentence before ${correctCircle}, and how the inserted sentence leads into the sentence after ${correctCircle}
- Max 600 Korean characters, no line breaks, no markdown, one continuous paragraph

**Output JSON only**:
{
  "sentence": "<the new English sentence>",
  "explanation": "<Korean 해설, one paragraph>"
}
`.trim();

  try {
    const msg = await CLAUDE.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = msg.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('');
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    return { sentence: parsed.sentence, explanation: parsed.explanation };
  } catch (e) {
    console.error('  Claude API error:', (e as Error).message);
    return null;
  }
}

async function main() {
  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');

  // 기존 '상' 삽입 문제 전부 로드 (25~28번, 43~45번 제외)
  const existing = await col
    .find({ textbook: TEXTBOOK, type: '삽입', difficulty: '상' })
    .toArray();

  // 제외할 source 패턴
  const EXCLUDE = ['25번', '26번', '27번', '28번', '43~45번'];
  const filtered = existing.filter(
    (d) => !EXCLUDE.some((ex) => String(d.source).includes(ex)),
  );

  console.log(`대상 지문: ${filtered.length}개 (제외 후)`);

  let created = 0;
  let failed = 0;

  for (let i = 0; i < filtered.length; i++) {
    const base = filtered[i];
    const qd = base.question_data as Record<string, unknown>;
    const para = String(qd.Paragraph ?? '');
    const sepIdx = para.indexOf('###');
    if (sepIdx < 0) { console.log(`  SKIP (no ###): ${base.source}`); continue; }

    const passageRaw = para.slice(sepIdx + 3).replace(/<[^>]+>/g, '').trim();
    const sentences = extractSentences(passageRaw);
    if (sentences.length < 5) {
      console.log(`  SKIP (문장 부족 ${sentences.length}): ${base.source}`);
      continue;
    }

    // 이미 사용된 위치들 수집
    const siblingDocs = await col
      .find({ textbook: TEXTBOOK, type: '삽입', difficulty: '상', source: base.source })
      .toArray();
    const usedPositions = siblingDocs
      .map((d) => parseAnswerPosition(String((d.question_data as any)?.CorrectAnswer ?? '')))
      .filter((p) => p > 0);

    const positions = pickPositions(sentences.length, usedPositions);
    console.log(`\n[${i + 1}/${filtered.length}] ${base.source} (문장 ${sentences.length}개, 기존위치 ${usedPositions.join(',')}) → 신규위치 ${positions.join(',')}`);

    for (const pos of positions) {
      const result = await generateInsertionQuestion(sentences, pos);
      if (!result) { failed++; console.log(`  ERROR: 생성 실패 (pos ${pos})`); continue; }

      const correctCircle = CIRCLED[pos - 1];
      const markedPassage = buildMarkedPassage(sentences, pos);
      const paragraph = `${result.sentence}\n###\n${markedPassage}`;

      // 기존 문항의 순서 기반으로 다음 번호 부여
      const existingCount = await col.countDocuments({ textbook: TEXTBOOK, type: '삽입', difficulty: '상', source: base.source });
      const 순서 = existingCount + 1;

      const question_data: Record<string, unknown> = {
        순서,
        Source: base.source,
        Category: '삽입',
        DifficultyLevel: '상',
        Question: '글의 흐름으로 보아, 주어진 문장이 들어가기에 가장 적절한 곳을 고르시오.',
        Paragraph: paragraph,
        Options: CIRCLED.join('\n'),
        OptionType: 'English',
        CorrectAnswer: correctCircle,
        Explanation: result.explanation,
        GeneratedSentence: true,
      };

      const saveResult = await saveGeneratedQuestionToDb({
        passage_id: String(base.passage_id),
        textbook: TEXTBOOK,
        source: String(base.source),
        type: '삽입',
        question_data,
        status: '완료',
        option_type: 'English',
        difficulty: '상',
      });

      if (saveResult.ok) {
        console.log(`  OK pos ${pos} (${correctCircle}): ${result.sentence.slice(0, 60)}…`);
        created++;
      } else {
        console.log(`  SAVE ERROR: ${saveResult.error}`);
        failed++;
      }

      await new Promise((r) => setTimeout(r, 300));
    }
  }

  console.log(`\n완료: ${created}건 생성, ${failed}건 실패`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
