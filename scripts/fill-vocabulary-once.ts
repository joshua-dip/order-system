/**
 * 일회성 스크립트: 특정 지문의 단어장에서 뜻·품사·CEFR·동의어·반의어가 없는 단어를 일괄 분석.
 * npx tsx scripts/fill-vocabulary-once.ts <passageId>
 */
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env') });
config({ path: path.join(__dirname, '..', '.env.local') });

import Anthropic from '@anthropic-ai/sdk';
import { getDb } from '@/lib/mongodb';
import { passageAnalysisFileNameForPassageId, type PassageStateStored, type VocabularyEntry } from '@/lib/passage-analyzer-types';
import { parseWordBlock } from '@/lib/passage-analyzer-vocabulary';

const BATCH = 12;

async function main() {
  const passageId = process.argv[2];
  if (!passageId) {
    console.error('Usage: npx tsx scripts/fill-vocabulary-once.ts <passageId>');
    process.exit(1);
  }

  const apiKey = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) { console.error('ANTHROPIC_API_KEY가 필요합니다.'); process.exit(1); }

  const anthropic = new Anthropic({ apiKey });
  const model = (process.env.ANTHROPIC_SOLVE_MODEL || '').trim() || 'claude-haiku-4-5-20251001';

  const fileName = passageAnalysisFileNameForPassageId(passageId.trim());
  const db = await getDb('gomijoshua');
  const col = db.collection('passage_analyses');

  const doc = await col.findOne<{ passageStates?: { main?: PassageStateStored } }>({ fileName });
  const main = doc?.passageStates?.main;
  if (!main || !Array.isArray(main.sentences)) {
    console.error('문서를 찾을 수 없습니다:', fileName);
    process.exit(1);
  }

  const list: VocabularyEntry[] = main.vocabularyList || [];
  const sentences = main.sentences || [];
  const koreanSentences = main.koreanSentences || [];

  const needsAnalysis = list.filter((v) => !v.meaning || !String(v.meaning).trim());
  console.error(`전체: ${list.length} | 분석필요: ${needsAnalysis.length} | 모델: ${model}`);

  if (needsAnalysis.length === 0) {
    console.error('모든 단어에 뜻이 이미 있습니다.');
    process.exit(0);
  }

  // 문맥 붙이기
  const withContexts = needsAnalysis.map((item) => {
    const pos = item.positions || [];
    const contexts: { english: string; korean: string }[] = [];
    for (const p of pos) {
      const en = sentences[p.sentence];
      const ko = koreanSentences[p.sentence] ?? '';
      if (en) contexts.push({ english: en, korean: ko });
    }
    return { item, contexts };
  });

  const resultMap = new Map<string, Record<string, unknown>>();

  for (let i = 0; i < withContexts.length; i += BATCH) {
    const batch = withContexts.slice(i, i + BATCH);
    const batchPrompt = batch
      .map(({ item, contexts }, idx) => {
        const ctx = contexts
          .map((c, j) => `${j + 1}. 영어: ${c.english}\n   한국어: ${c.korean}`)
          .join('\n');
        return `[단어 ${idx + 1}: "${item.word}"]\n문맥:\n${ctx || '(문맥 없음)'}`;
      })
      .join('\n\n');

    const formatExample = batch
      .map((_, idx) =>
        `[단어 ${idx + 1}: "단어"]\n유형: word\n품사: n.\nCEFR: B1\n뜻: 한글 주요 뜻\n부가뜻: 다른 한글 표현(없으면 없음)\n영어유의어: really, truly\n영어반의어: supposedly(없으면 없음)`
      )
      .join('\n\n');

    const prompt = `다음 영어 단어들을 문맥에 맞게 각각 종합 분석해주세요.

${batchPrompt}

각 단어마다 아래 형식으로만 답변하세요.
유형: [word 또는 phrase]
품사: [n., v., adj. 등]
CEFR: [반드시 A1, A2, B1, B2, C1, C2 중 하나만]
뜻: [문맥에 맞는 주요 뜻, 한국어]
부가뜻: [부가 한글 의미, 없으면 없음]
영어유의어: [뜻이 같은 영어 단어·구만 쉼표로]
영어반의어: [뜻이 반대인 영어 단어, 없으면 없음]

중요:
- 뜻은 반드시 단수 명사형으로 쓰세요(예: "공무원들" ✗ → "공무원" ✓).
- 영어유의어·영어반의어는 반드시 기본형(단수·원형)으로 쓰세요(예: administrators ✗ → administrator ✓).

답변 형식 예시:
${formatExample}

답변:`;

    try {
      const msg = await anthropic.messages.create({
        model,
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      });
      const text = (msg.content[0] as { type: string; text: string }).text.trim();
      const splits = text.split(/(?=\[단어\s*\d+[^\]]*\])/i);
      const blocks = splits.filter((s) => /\[단어\s*\d+/i.test(s));
      const effectiveBlocks = blocks.length >= batch.length ? blocks : [text];
      for (let j = 0; j < batch.length; j++) {
        const block = effectiveBlocks[j] || effectiveBlocks[0] || text;
        const { item } = batch[j];
        const parsed = parseWordBlock(block, item as unknown as Record<string, unknown>);
        resultMap.set(item.word, parsed);
        console.error(`  ${item.word} → ${(parsed.cefr as string) || '?'} | ${(parsed.meaning as string)?.slice(0, 20) || ''}`);
      }
    } catch (e) {
      console.error('배치 오류, 원본 유지:', e);
      for (const { item } of batch) resultMap.set(item.word, item as unknown as Record<string, unknown>);
    }

    if (i + BATCH < withContexts.length) await new Promise((r) => setTimeout(r, 200));
  }

  const updated = list.map((v) => {
    const r = resultMap.get(v.word);
    return r ? (r as unknown as VocabularyEntry) : v;
  });

  const currentDoc = await col.findOne({ fileName });
  const newVersion = Math.floor(Number((currentDoc as { version?: number })?.version) || 0) + 1;
  const now = new Date();
  await col.updateOne(
    { fileName },
    {
      $set: {
        'passageStates.main.vocabularyList': updated,
        version: newVersion,
        lastEditorId: 'cli',
        lastEditorName: 'vocab-fill',
        lastSaved: now.toISOString(),
        updatedAt: now,
      },
    }
  );
  console.error(`저장 완료 → version ${newVersion}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
