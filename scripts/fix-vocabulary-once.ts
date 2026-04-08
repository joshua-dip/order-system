/**
 * 일회성 스크립트: 26년 3월 고1 영어모의고사 — 단어장 데이터 일괄 보정
 *
 * 수정 내용:
 *   1. 뜻(meaning)에서 불필요한 복수 접미사 '들' 제거 (e.g. "공무원들" → "공무원")
 *   2. 약어 소문자 → 대문자 (e.g. "bc" → "BC")
 *   3. 노이즈 단어 삭제 (서수 접미사: st, nd, rd, th 등)
 *   4. 빈 meaning 항목 로깅
 *
 * Usage: npx tsx scripts/fix-vocabulary-once.ts [--dry-run]
 */
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env') });
config({ path: path.join(__dirname, '..', '.env.local') });

import { getDb } from '@/lib/mongodb';
import type { VocabularyEntry } from '@/lib/passage-analyzer-types';
import { toBaseForm, toBaseFormList } from '@/lib/passage-analyzer-vocabulary-generate';

const DRY_RUN = process.argv.includes('--dry-run');

const KNOWN_ABBREVIATIONS: Record<string, string> = {
  bc: 'BC', ad: 'AD', eu: 'EU', un: 'UN', uk: 'UK',
  dna: 'DNA', rna: 'RNA', ai: 'AI', gps: 'GPS', ceo: 'CEO',
  tv: 'TV', pc: 'PC', ok: 'OK', iq: 'IQ',
};

const NOISE_WORDS = new Set(['st', 'nd', 'rd', 'th', 'etc', 'll', 've', 're', 'd', 'm', 'o', 's', 't']);

function fixPluralSuffix(meaning: string): string {
  return meaning.replace(/([가-힣])들(?=[,\s·;]|$)/g, '$1');
}

function fixKoreanPastTense(meaning: string): string {
  return meaning
    .replace(/했다/g, '하다')
    .replace(/됐다/g, '되다')
    .replace(/였다/g, '이다')
    .replace(/었다/g, '다')
    .replace(/았다/g, '다');
}

function fixAbbreviation(word: string): string | null {
  const lower = word.toLowerCase();
  return KNOWN_ABBREVIATIONS[lower] ?? null;
}

async function main() {
  const db = await getDb('gomijoshua');
  const col = db.collection('passage_analyses');

  const textbook = process.argv.find((a) => a.startsWith('--textbook='))?.split('=')[1]?.trim()
    || '26년 3월 고1 영어모의고사';
  const passagesCol = db.collection('passages');
  const passages = await passagesCol
    .find({ textbook })
    .project({ _id: 1 })
    .toArray();

  const passageIds = passages.map((p) => p._id.toString());
  console.log(`대상 교재: ${textbook} — ${passageIds.length}개 지문`);

  const fileNames = passageIds.map((id) => `passage:${id}`);
  const docs = await col
    .find({ fileName: { $in: fileNames } })
    .toArray();

  console.log(`passage_analyses 문서 수: ${docs.length}`);

  let totalUpdated = 0;
  let totalRemoved = 0;
  let totalMeaningFixed = 0;
  let totalAbbrevFixed = 0;
  let totalEmptyMeaning = 0;
  let totalWordSingularized = 0;
  let totalFieldSingularized = 0;

  for (const doc of docs) {
    const main = (doc as any).passageStates?.main;
    if (!main || !Array.isArray(main.vocabularyList)) continue;

    const list: VocabularyEntry[] = main.vocabularyList;
    let changed = false;
    const newList: VocabularyEntry[] = [];

    for (const item of list) {
      if (NOISE_WORDS.has(item.word.toLowerCase())) {
        totalRemoved++;
        changed = true;
        console.log(`  [삭제] ${doc.fileName} — "${item.word}"`);
        continue;
      }

      let modified = { ...item };

      const abbrevFix = fixAbbreviation(item.word);
      if (abbrevFix && item.word !== abbrevFix) {
        console.log(`  [약어] ${doc.fileName} — "${item.word}" → "${abbrevFix}"`);
        modified.word = abbrevFix;
        totalAbbrevFixed++;
        changed = true;
      }

      if (modified.wordType !== 'phrase') {
        const baseWord = toBaseForm(modified.word);
        if (baseWord !== modified.word) {
          console.log(`  [원형] ${doc.fileName} — "${modified.word}" → "${baseWord}"`);
          modified.word = baseWord;
          totalWordSingularized++;
          changed = true;
        }
      }

      for (const field of ['synonym', 'antonym', 'opposite'] as const) {
        const val = modified[field];
        if (val) {
          const fixed = toBaseFormList(val);
          if (fixed !== val) {
            console.log(`  [${field}단수] ${doc.fileName} — "${val}" → "${fixed}"`);
            modified = { ...modified, [field]: fixed };
            totalFieldSingularized++;
            changed = true;
          }
        }
      }

      if (item.meaning) {
        let fixedMeaning = fixPluralSuffix(item.meaning);
        fixedMeaning = fixKoreanPastTense(fixedMeaning);
        if (fixedMeaning !== item.meaning) {
          console.log(`  [뜻보정] ${doc.fileName} — "${item.meaning}" → "${fixedMeaning}"`);
          modified.meaning = fixedMeaning;
          totalMeaningFixed++;
          changed = true;
        }
      } else {
        totalEmptyMeaning++;
      }

      newList.push(modified);
    }

    if (changed) {
      totalUpdated++;
      if (!DRY_RUN) {
        await col.updateOne(
          { _id: doc._id },
          { $set: { 'passageStates.main.vocabularyList': newList } }
        );
        console.log(`✅ ${doc.fileName} 저장 완료 (${list.length} → ${newList.length}개)`);
      } else {
        console.log(`🔍 [dry-run] ${doc.fileName} 변경 예정 (${list.length} → ${newList.length}개)`);
      }
    }
  }

  console.log('\n=== 요약 ===');
  console.log(`수정된 문서: ${totalUpdated}/${docs.length}`);
  console.log(`삭제된 노이즈 단어: ${totalRemoved}`);
  console.log(`약어 대문자 수정: ${totalAbbrevFixed}`);
  console.log(`복수형 뜻 수정: ${totalMeaningFixed}`);
  console.log(`영단어 단수화: ${totalWordSingularized}`);
  console.log(`동의어/반의어 단수화: ${totalFieldSingularized}`);
  console.log(`빈 뜻 항목: ${totalEmptyMeaning}`);
  if (DRY_RUN) console.log('(dry-run 모드 — 실제 변경 없음)');

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
