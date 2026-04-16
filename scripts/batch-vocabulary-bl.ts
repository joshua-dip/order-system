/**
 * BL 단어장 주문 배치 작업
 * 사용: npx tsx scripts/batch-vocabulary-bl.ts BL-20260415-001
 */
import { config } from 'dotenv';
import path from 'path';
config({ path: path.resolve(process.cwd(), '.env.local') });

import Anthropic from '@anthropic-ai/sdk';
import { getDb } from '../lib/mongodb';
import { passageAnalysisFileNameForPassageId } from '../lib/passage-analyzer-types';
import { buildVocabularyListFromSentences } from '../lib/passage-analyzer-vocabulary-generate';
import { parseWordBlock, BATCH_SIZE } from '../lib/passage-analyzer-vocabulary';
import type { VocabularyEntry } from '../lib/passage-analyzer-types';

const ORDER_NUMBER = process.argv[2] || 'BL-20260415-001';

async function analyzeVocabularyWithAI(
  anthropic: Anthropic,
  model: string,
  list: VocabularyEntry[],
  englishSentences: string[],
  koreanSentences: string[],
): Promise<VocabularyEntry[]> {
  const toAnalyze = list.filter((item) => !item.meaning || !item.cefr);
  const alreadyDone = list.filter((item) => item.meaning && item.cefr);

  if (toAnalyze.length === 0) return list;

  const results: VocabularyEntry[] = [...alreadyDone];

  for (let i = 0; i < toAnalyze.length; i += BATCH_SIZE) {
    const batch = toAnalyze.slice(i, i + BATCH_SIZE);

    const batchPrompt = batch.map((item, idx) => {
      const wordContexts: { english: string; korean: string }[] = [];
      for (const pos of item.positions || []) {
        const en = englishSentences[pos.sentence];
        const ko = koreanSentences[pos.sentence];
        if (en && ko) wordContexts.push({ english: en, korean: ko });
      }
      const ctx = wordContexts
        .map((c, j) => `${j + 1}. 영어: ${c.english}\n   한국어: ${c.korean}`)
        .join('\n');
      return `[단어 ${idx + 1}: "${item.word}"]\n문맥:\n${ctx}`;
    }).join('\n\n');

    const formatExample = batch.map((_, idx) =>
      `[단어 ${idx + 1}: "단어"]\n유형: word\n품사: n.\nCEFR: B1\n뜻: 한글 주요 뜻\n부가뜻: 없음\n영어유의어: synonym1, synonym2\n영어반의어: antonym1`
    ).join('\n\n');

    const prompt = `다음 영어 단어들을 문맥에 맞게 각각 종합 분석해주세요.

${batchPrompt}

각 단어마다 아래 형식으로만 답변하세요. 라벨을 정확히 지키세요.
유형: [word 또는 phrase]
품사: [n., v., adj. 등]
CEFR: [반드시 A1, A2, B1, B2, C1, C2 중 하나만]
뜻: [문맥에 맞는 주요 뜻, 한국어]
부가뜻: [부가 한글 의미, 없으면 없음]
영어유의어: [뜻이 같은 영어 단어·구만 쉼표로. 없으면 없음]
영어반의어: [뜻이 반대인 영어 단어만. 없으면 없음]

중요:
- 뜻은 반드시 단수 명사형으로 쓰세요.
- 영어유의어·영어반의어는 반드시 기본형(단수·원형)으로 쓰세요.

답변 형식 예시:
${formatExample}

답변:`;

    try {
      const message = await anthropic.messages.create({
        model,
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      });
      const text = message.content[0].type === 'text' ? message.content[0].text.trim() : '';
      const splits = text.split(/(?=\[단어\s*\d+[^\]]*\])/i);
      const wordBlocks = splits.filter((s) => /\[단어\s*\d+/i.test(s));
      const effectiveBlocks = wordBlocks.length >= batch.length ? wordBlocks : [text];

      for (let j = 0; j < batch.length; j++) {
        const block = effectiveBlocks[j] || effectiveBlocks[0] || text;
        const parsed = parseWordBlock(block, batch[j] as unknown as Record<string, unknown>);
        results.push(parsed as unknown as VocabularyEntry);
      }
    } catch (e) {
      console.error(`  ⚠ AI 분석 실패 (배치 ${i / BATCH_SIZE + 1}):`, e);
      results.push(...batch);
    }

    if (i + BATCH_SIZE < toAnalyze.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  return results;
}

async function main() {
  const apiKey = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) { console.error('ANTHROPIC_API_KEY 없음'); process.exit(1); }

  const anthropic = new Anthropic({ apiKey });
  const model = process.env.ANTHROPIC_SOLVE_MODEL?.trim() || 'claude-sonnet-4-6';

  const db = await getDb('gomijoshua');

  const order = await db.collection('orders').findOne({ orderNumber: ORDER_NUMBER });
  if (!order) { console.error(`주문 없음: ${ORDER_NUMBER}`); process.exit(1); }

  const meta = order.orderMeta as Record<string, unknown>;
  const textbook = String(meta.selectedTextbook ?? meta.textbook ?? '');
  const selectedLessons: string[] = Array.isArray(meta.selectedLessons) ? meta.selectedLessons as string[] : [];

  console.log(`\n주문: ${ORDER_NUMBER}`);
  console.log(`교재: ${textbook}`);
  console.log(`지문: ${selectedLessons.length}개\n`);

  const passages = await db.collection('passages')
    .find({ textbook, source_key: { $in: selectedLessons } })
    .project({ _id: 1, chapter: 1, number: 1, source_key: 1, content: 1 })
    .sort({ chapter: 1, number: 1 })
    .toArray();

  console.log(`DB 지문 매칭: ${passages.length}개\n`);

  let done = 0, skipped = 0, failed = 0;

  for (const p of passages) {
    const source = String(p.source_key ?? '');
    const pid = String(p._id);
    const fileName = passageAnalysisFileNameForPassageId(pid);

    const content = p.content as Record<string, unknown> | undefined;
    const sentences_en: string[] = Array.isArray(content?.sentences_en)
      ? (content!.sentences_en as string[])
      : [];
    const sentences_ko: string[] = Array.isArray(content?.sentences_ko)
      ? (content!.sentences_ko as string[])
      : [];

    if (sentences_en.length === 0) {
      console.log(`  ⊘ [${source}] sentences_en 없음 — 스킵`);
      skipped++;
      continue;
    }

    const existing = await db.collection('passage_analyses').findOne({ fileName });
    const existingList = (existing as any)?.passageStates?.main?.vocabularyList;
    if (Array.isArray(existingList) && existingList.length > 0) {
      console.log(`  ✓ [${source}] 이미 ${existingList.length}개 단어 있음 — 스킵`);
      skipped++;
      continue;
    }

    process.stdout.write(`  → [${source}] 단어 추출 중...`);

    try {
      const rawList = buildVocabularyListFromSentences(sentences_en, { sourcePassage: source });
      process.stdout.write(` ${rawList.length}개 → AI 분석 중...`);

      const analyzedList = await analyzeVocabularyWithAI(
        anthropic, model, rawList, sentences_en, sentences_ko
      );
      process.stdout.write(` 완료\n`);

      const now = new Date();
      await db.collection('passage_analyses').updateOne(
        { fileName },
        {
          $set: {
            fileName,
            teacherId: null,
            collaborationHostId: null,
            passageStates: {
              main: {
                vocabularyList: analyzedList,
                showVocabulary: true,
                sentences: sentences_en,
                koreanSentences: sentences_ko,
              },
            },
            lastEditorId: 'batch-script',
            lastEditorName: 'batch-vocabulary-bl',
            lastSaved: now.toISOString(),
            updatedAt: now,
          },
          $setOnInsert: { createdAt: now },
        },
        { upsert: true }
      );

      console.log(`     저장 완료: ${analyzedList.length}개 단어`);
      done++;
    } catch (e) {
      console.error(`  ✗ [${source}] 실패:`, e);
      failed++;
    }

    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`\n=== 완료 ===`);
  console.log(`처리: ${done}, 스킵: ${skipped}, 실패: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
