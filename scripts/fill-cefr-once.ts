/**
 * 일회성 스크립트: 특정 지문의 단어장에서 CEFR이 없는 단어에 난이도를 채운다.
 * npx tsx scripts/fill-cefr-once.ts <passageId>
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

const BATCH = 12;

function parseCefr(text: string): string {
  const m1 = text.match(/CEFR\s*[:：]\s*([^\n]+)/i);
  if (m1) {
    const t = m1[1].toUpperCase().trim();
    const m = t.match(/\b(A1|A2|B1|B2|C1|C2)\b/);
    return m ? m[1] : '';
  }
  const m = text.toUpperCase().match(/\b(A1|A2|B1|B2|C1|C2)\b/);
  return m ? m[1] : '';
}

async function main() {
  const passageId = process.argv[2];
  if (!passageId) {
    console.error('Usage: npx tsx scripts/fill-cefr-once.ts <passageId>');
    process.exit(1);
  }

  const apiKey = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY가 필요합니다.');
    process.exit(1);
  }

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

  const noCefr = list.filter((v) => !v.cefr || !String(v.cefr).trim());
  console.error(`전체: ${list.length} | CEFR없음: ${noCefr.length} | 모델: ${model}`);

  if (noCefr.length === 0) {
    console.error('모든 단어에 CEFR이 이미 있습니다.');
    process.exit(0);
  }

  const cefrMap = new Map<string, string>();

  for (let i = 0; i < noCefr.length; i += BATCH) {
    const batch = noCefr.slice(i, i + BATCH);
    const batchPrompt = batch
      .map((item, idx) => {
        const pos = item.positions || [];
        const ctxLines = pos
          .slice(0, 2)
          .map((p) => {
            const en = sentences[p.sentence] || '';
            const ko = koreanSentences[p.sentence] || '';
            return `   영어: ${en}${ko ? '\n   한국어: ' + ko : ''}`;
          })
          .join('\n');
        const hint = [
          item.meaning ? `뜻: ${item.meaning}` : '',
          item.partOfSpeech ? `품사: ${item.partOfSpeech}` : '',
        ]
          .filter(Boolean)
          .join(' | ');
        return `[단어 ${idx + 1}: "${item.word}"]${hint ? ' (' + hint + ')' : ''}\n문맥:\n${ctxLines || '(문맥 없음)'}`;
      })
      .join('\n\n');

    const prompt = `다음 영어 단어들의 CEFR 어휘 난이도만 판정하세요.

${batchPrompt}

각 단어마다 아래 형식으로만:
[단어 N]
CEFR: B1

답변:`;

    const msg = await anthropic.messages.create({
      model,
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = (msg.content[0] as { type: string; text: string }).text.trim();
    const splits = text.split(/(?=\[단어\s*\d+)/i);
    const blocks = splits.filter((s) => /\[단어\s*\d+/i.test(s));
    for (let j = 0; j < batch.length; j++) {
      const block = blocks[j] || '';
      const cefr = parseCefr(block);
      cefrMap.set(batch[j].word, cefr);
      console.error(`  ${batch[j].word} → ${cefr || '(미정)'}`);
    }
    if (i + BATCH < noCefr.length) await new Promise((r) => setTimeout(r, 200));
  }

  const updated = list.map((v) => {
    if (cefrMap.has(v.word)) return { ...v, cefr: cefrMap.get(v.word) || v.cefr || '' };
    return v;
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
        lastEditorName: 'cefr-fill',
        lastSaved: now.toISOString(),
        updatedAt: now,
      },
    }
  );
  console.error(`저장 완료 → version ${newVersion}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
