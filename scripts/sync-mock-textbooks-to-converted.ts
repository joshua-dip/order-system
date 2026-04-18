/**
 * 표준화된 12종 고2 학평 모의고사를 converted_data.json + converted_textbook_json
 * 컬렉션에 한 번에 동기화합니다.
 *
 *   드라이런 (기본):
 *     DOTENV_CONFIG_PATH=.env.local npx tsx scripts/sync-mock-textbooks-to-converted.ts
 *
 *   실제 적용:
 *     DOTENV_CONFIG_PATH=.env.local npx tsx scripts/sync-mock-textbooks-to-converted.ts --apply
 *
 * 동작
 *   - passages에서 `YY년 M월 고2 영어모의고사 (지역[, 메모])` 패턴의 교재만 탐색
 *   - 각 교재별 chapter/order/number를 모아 부교재 branch 생성
 *   - 기존 merged 데이터 위에 덮어쓰고 writeMergedConvertedData 호출
 *     (Mongo `converted_textbook_json` upsert + 로컬 converted_data.json 갱신)
 */
import { config } from 'dotenv';
config({ path: process.env.DOTENV_CONFIG_PATH || '.env.local' });

import { getDb } from '../lib/mongodb';
import { readMergedConvertedData, writeMergedConvertedData } from '../lib/converted-data-store';

const APPLY = process.argv.includes('--apply');

type PassageRow = { chapter?: unknown; number?: unknown; order?: unknown };

/** 표준화된 학평 모의고사만 잡는 정규식 (예: "21년 3월 고2 영어모의고사 (서울시)") */
const TARGET_REGEX = /^\d{2}년 \d{1,2}월 고[12] 영어모의고사 \(/;

async function buildBranchForTextbook(textbook: string) {
  const db = await getDb('gomijoshua');
  const docs = (await db
    .collection('passages')
    .find({ textbook })
    .project({ chapter: 1, number: 1, order: 1 })
    .sort({ chapter: 1, order: 1, number: 1 })
    .toArray()) as PassageRow[];

  if (docs.length === 0) return null;

  const byChapter = new Map<string, Map<string, { order: number }>>();
  for (const p of docs) {
    const ch = (String(p.chapter ?? '').trim()) || '(강 미지정)';
    const num = String(p.number ?? '').trim();
    if (!num) continue;
    const ord =
      typeof p.order === 'number' && Number.isFinite(p.order) ? p.order : 1_000_000;
    if (!byChapter.has(ch)) byChapter.set(ch, new Map());
    const inner = byChapter.get(ch)!;
    const prev = inner.get(num);
    if (!prev || ord < prev.order) inner.set(num, { order: ord });
  }

  const lessonKeys = [...byChapter.keys()].sort((a, b) => a.localeCompare(b, 'ko'));
  const 부교재Inner: Record<string, Record<string, { 번호: string }[]>> = {};
  부교재Inner[textbook] = {};
  for (const lesson of lessonKeys) {
    const nums = byChapter.get(lesson)!;
    const entries = [...nums.entries()].sort((a, b) => {
      const o = a[1].order - b[1].order;
      if (o !== 0) return o;
      return a[0].localeCompare(b[0], 'ko');
    });
    부교재Inner[textbook][lesson] = entries.map(([n]) => ({ 번호: n }));
  }

  const branch = { Sheet1: { 부교재: 부교재Inner } };
  const passageCount = docs.filter((p) => String(p.number ?? '').trim()).length;
  return { branch, lessonCount: lessonKeys.length, passageCount };
}

async function main() {
  const db = await getDb('gomijoshua');
  const all = (await db.collection('passages').distinct('textbook', {
    textbook: { $regex: TARGET_REGEX },
  })) as string[];

  if (all.length === 0) {
    console.log('대상 교재가 없습니다.');
    return;
  }
  all.sort((a, b) => a.localeCompare(b, 'ko'));

  console.log('───────────────────────────────────────────────');
  console.log(`${APPLY ? '적용' : '드라이런'} · ${all.length}종 동기화 예정`);
  console.log('───────────────────────────────────────────────');

  const existing = await readMergedConvertedData();
  const next: Record<string, unknown> = { ...existing };

  let totalLessons = 0;
  let totalPassages = 0;
  const replaced: string[] = [];
  const added: string[] = [];

  for (const textbook of all) {
    const built = await buildBranchForTextbook(textbook);
    if (!built) {
      console.warn(`  - ${textbook} (passages 0건, 건너뜀)`);
      continue;
    }
    const before = existing[textbook] ? '교체' : '신규';
    if (existing[textbook]) replaced.push(textbook);
    else added.push(textbook);

    next[textbook] = built.branch;
    totalLessons += built.lessonCount;
    totalPassages += built.passageCount;
    console.log(
      `  ${before === '신규' ? '＋' : '↻'}  ${textbook}   (강 ${built.lessonCount}개 · 원문 ${built.passageCount}건)`
    );
  }

  console.log('───────────────────────────────────────────────');
  console.log(`총: 강 ${totalLessons}개 · 원문 ${totalPassages}건 · 신규 ${added.length}종 · 교체 ${replaced.length}종`);

  if (!APPLY) {
    console.log('\n드라이런 종료. 실제 적용은 --apply 플래그를 추가하세요.');
    return;
  }

  await writeMergedConvertedData(next);
  console.log('\n✓ converted_textbook_json 컬렉션 + app/data/converted_data.json 양쪽 업데이트 완료');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
