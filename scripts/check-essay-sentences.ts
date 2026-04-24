import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local' });
dotenvConfig();
import { getDb } from '../lib/mongodb';

async function main() {
  const passageId = process.argv[2];
  if (!passageId) {
    console.error('usage: tsx scripts/check-essay-sentences.ts <passageId>');
    process.exit(1);
  }
  const fileName = `passage:${passageId}`;
  const db = await getDb('gomijoshua');
  const doc = await db.collection('passage_analyses').findOne({ fileName });
  if (!doc) {
    console.log(JSON.stringify({ found: false, fileName }, null, 2));
    process.exit(0);
  }
  const main = (doc as any)?.passageStates?.main ?? {};
  const sentences: string[] = Array.isArray(main.sentences) ? main.sentences : [];
  const koreanSentences: string[] = Array.isArray(main.koreanSentences) ? main.koreanSentences : [];
  const essayIdx: number[] = Array.isArray(main.essayHighlightedSentences) ? main.essayHighlightedSentences : [];
  const topicIdx: number[] = Array.isArray(main.topicHighlightedSentences) ? main.topicHighlightedSentences : [];
  const out = {
    found: true,
    fileName,
    updatedAt: (doc as any).updatedAt ?? (doc as any).lastSaved ?? null,
    lastEditorName: (doc as any).lastEditorName ?? null,
    sentenceCount: sentences.length,
    topicHighlightedSentences: topicIdx,
    essayHighlightedSentences: essayIdx,
    essaySelected: essayIdx.map((i) => ({
      index: i,
      en: sentences[i] ?? null,
      ko: koreanSentences[i] ?? null,
    })),
  };
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error('ERROR:', e?.message || e);
  process.exit(1);
});
