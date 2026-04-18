/**
 * 임시 스크립트: GivenSentence + "\n\n" + Passage → Paragraph 필드 생성
 * 26년 3월 고3 영어모의고사 삽입-고난도 12건
 */
import { ObjectId } from 'mongodb';
import { getDb } from '../lib/mongodb';

const ids = [
  '69de549fe1ae77b803b24478',
  '69de54afe1ae77b803b24479',
  '69de54bbe1ae77b803b2447a',
  '69de54c9e1ae77b803b2447b',
  '69de54dae1ae77b803b2447c',
  '69de54e6e1ae77b803b2447d',
  '69de54f6e1ae77b803b2447e',
  '69de5504e1ae77b803b2447f',
  '69de5517e1ae77b803b24480',
  '69de5525e1ae77b803b24481',
  '69de5533e1ae77b803b24482',
  '69de5544e1ae77b803b24483',
];

async function main() {
  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');

  for (const id of ids) {
    const doc = await col.findOne({ _id: new ObjectId(id) });
    if (!doc) { console.log(`NOT FOUND: ${id}`); continue; }

    const qd = doc.question_data as Record<string, unknown>;
    const given = (qd.GivenSentence as string ?? '').trim();
    const passage = (qd.Passage as string ?? '').trim();

    if (!given || !passage) {
      console.log(`SKIP ${id}: GivenSentence=${!!given}, Passage=${!!passage}`);
      continue;
    }

    const paragraph = `${given}\n\n${passage}`;
    const result = await col.updateOne(
      { _id: new ObjectId(id) },
      { $set: { 'question_data.Paragraph': paragraph, updated_at: new Date() } }
    );
    console.log(`${id} (${doc.source}) → modified: ${result.modifiedCount}`);
  }

  console.log('Done.');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
