/**
 * passages 에 등록된 교재 중, 병합 converted 데이터에
 * 강·번호 인덱스(Sheet1 → 부교재 → 교재명)가 없거나 비어 있는 교재만
 * passages 기준으로 채웁니다.
 *
 *   드라이런 (기본):
 *     DOTENV_CONFIG_PATH=.env.local npx tsx scripts/sync-passages-to-converted-missing.ts
 *
 *   적용:
 *     DOTENV_CONFIG_PATH=.env.local npx tsx scripts/sync-passages-to-converted-missing.ts --apply
 *
 *   전 교재 덮어쓰기 (병합에 이미 있어도 passages 기준으로 다시 씀):
 *     ... --apply --force
 */
import { config } from 'dotenv';
config({ path: process.env.DOTENV_CONFIG_PATH || '.env.local' });

import { getDb } from '../lib/mongodb';
import { readMergedConvertedData, writeMergedConvertedData } from '../lib/converted-data-store';
import {
  buildMergedTextbookBranchFromPassages,
  convertedMergedHasTextbookLessonIndex,
  type PassageRow,
} from '../lib/build-converted-branch-from-passages';

const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');

async function main() {
  const db = await getDb('gomijoshua');
  const textbooks = ((await db.collection('passages').distinct('textbook')) as string[])
    .filter((t) => String(t).trim().length > 0)
    .sort((a, b) => a.localeCompare(b, 'ko'));

  if (textbooks.length === 0) {
    console.log('passages 에 교재가 없습니다.');
    return;
  }

  const merged = await readMergedConvertedData();
  const toSync: string[] = [];
  for (const tb of textbooks) {
    if (FORCE || !convertedMergedHasTextbookLessonIndex(merged, tb)) toSync.push(tb);
  }

  console.log('───────────────────────────────────────────────');
  console.log(
    `${APPLY ? '적용' : '드라이런'} · passages 교재 ${textbooks.length}종 중 동기화 대상 ${toSync.length}종` +
      (FORCE ? ' (--force: 전체 passages 기준 덮어쓰기)' : ' (병합에 강·번호 인덱스 없는 교재만)'),
  );
  console.log('───────────────────────────────────────────────');

  if (toSync.length === 0) {
    console.log('추가할 교재가 없습니다.');
    return;
  }

  const next: Record<string, unknown> = { ...merged };
  let totalLessons = 0;
  let totalPassages = 0;

  for (const textbook of toSync) {
    const docs = (await db
      .collection('passages')
      .find({ textbook })
      .project({ chapter: 1, number: 1, order: 1 })
      .sort({ chapter: 1, order: 1, number: 1 })
      .toArray()) as PassageRow[];

    const built = buildMergedTextbookBranchFromPassages(textbook, docs);
    if (!built) {
      console.warn(`  ⊗ ${textbook}  (번호 있는 지문 없음, 건너뜀)`);
      continue;
    }
    next[textbook] = built.branch;
    totalLessons += built.lessonCount;
    totalPassages += built.passageCount;
    const had = convertedMergedHasTextbookLessonIndex(merged, textbook);
    console.log(
      `  ${had ? '↻' : '＋'} ${textbook}   강 ${built.lessonCount}개 · 번호 슬롯 ${built.passageCount}건`,
    );
  }

  console.log('───────────────────────────────────────────────');
  console.log(`합계: 강 ${totalLessons}개 · 번호 슬롯 ${totalPassages}건 · 교재 ${toSync.length}종 처리 시도`);

  if (!APPLY) {
    console.log('\n드라이런 종료. 적용: --apply');
    return;
  }

  await writeMergedConvertedData(next);
  console.log('\n✓ writeMergedConvertedData (Mongo merged + converted_data.json 가능 시) 완료');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
