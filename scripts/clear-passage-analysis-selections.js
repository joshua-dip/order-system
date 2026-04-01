/**
 * passage_analyses 에서 특정 지문의 주제/서술형/SVOC 선택만 비웁니다.
 * 사용: node scripts/clear-passage-analysis-selections.js [fileName부분문자열]
 * 예: node scripts/clear-passage-analysis-selections.js 69baf53d
 */
const { MongoClient } = require('mongodb');
const { config } = require('dotenv');
const path = require('path');

config({ path: path.resolve(process.cwd(), '.env.local') });

const needle = (process.argv[2] || '69baf53d').trim();
if (!needle) {
  console.error('검색 문자열이 필요합니다.');
  process.exit(1);
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI 없음 (.env.local)');
    process.exit(1);
  }
  const client = new MongoClient(uri);
  await client.connect();
  const col = client.db('gomijoshua').collection('passage_analyses');

  const doc = await col.findOne({ fileName: { $regex: needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } });
  if (!doc) {
    console.error(`fileName에 "${needle}" 가 포함된 문서를 찾지 못했습니다.`);
    await client.close();
    process.exit(1);
  }

  const fileName = doc.fileName;
  const main = doc.passageStates && doc.passageStates.main;
  if (!main || typeof main !== 'object') {
    console.error('passageStates.main 없음:', fileName);
    await client.close();
    process.exit(1);
  }

  const topic = Array.isArray(main.topicHighlightedSentences) ? main.topicHighlightedSentences : [];
  const essay = Array.isArray(main.essayHighlightedSentences) ? main.essayHighlightedSentences : [];
  const topicNext = topic.filter((i) => i !== 0);
  const essayNext = essay.filter((i) => i !== 0);

  const $set = {
    'passageStates.main.topicHighlightedSentences': topicNext,
    'passageStates.main.essayHighlightedSentences': essayNext,
  };
  const $unset = {
    'passageStates.main.svocData.0': '',
  };

  await col.updateOne({ fileName }, { $set, $unset });

  console.log('완료:', fileName);
  console.log('  topicHighlightedSentences:', topic, '→', topicNext);
  console.log('  essayHighlightedSentences:', essay, '→', essayNext);
  console.log('  svocData[0] 제거(unset)');

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
