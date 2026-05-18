/**
 * 일회성: '26년 5월 고3 영어모의고사' passages 의 chapter/source_key 상태 확인.
 * 출력만 하고 변경 X.
 */
import { config } from 'dotenv';
config({ path: process.env.DOTENV_CONFIG_PATH || '.env.local' });

import { getDb } from '../lib/mongodb';

async function main() {
  const TEXTBOOK = '26년 5월 고3 영어모의고사';
  const db = await getDb('gomijoshua');
  const docs = await db
    .collection('passages')
    .find({ textbook: TEXTBOOK })
    .project({ _id: 1, textbook: 1, chapter: 1, number: 1, source_key: 1 })
    .toArray();

  /** chapter / source_key 분포 (값별 카운트) */
  const chapterDist: Record<string, number> = {};
  const sourceKeyDist: Record<string, number> = {};
  for (const d of docs) {
    const ch = String(d.chapter ?? '');
    const sk = String(d.source_key ?? '');
    chapterDist[ch] = (chapterDist[ch] ?? 0) + 1;
    sourceKeyDist[sk] = (sourceKeyDist[sk] ?? 0) + 1;
  }
  console.log(JSON.stringify({
    total: docs.length,
    distinct_chapters: Object.keys(chapterDist).length,
    chapter_distribution: chapterDist,
    sample: docs.slice(0, 5).map(d => ({
      _id: String(d._id),
      chapter: d.chapter,
      number: d.number,
      source_key: d.source_key,
    })),
    source_keys_with_old_order: Object.keys(sourceKeyDist).filter(k => k.includes('고3 5월')),
    chapters_with_old_order: Object.keys(chapterDist).filter(k => k.includes('고3 5월')),
  }, null, 2));
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
