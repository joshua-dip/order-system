/**
 * passage_analyses 전수 검사 → svocData 가 char-offset 으로 저장된 entry 들을 word-index 로 변환·저장.
 *
 * 컨벤션 통일:
 *  - 새 분석 API (`/api/admin/syntax-analyzer/analyze-svoc`) 는 이미 `findWordIndices` 로 word-index 저장.
 *  - 일부 과거 데이터만 char-offset 으로 남아 있음 → 이 스크립트가 정리.
 *  - runtime normalizer (lib/svoc-index-normalize.ts) 는 안전망으로 유지.
 *
 * 사용:
 *   dry-run:  MONGODB_URI="..." npx tsx scripts/qna-migrate-svoc-word-indices.ts
 *   apply:    MONGODB_URI="..." npx tsx scripts/qna-migrate-svoc-word-indices.ts --apply
 */

import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { normalizeSvocSentenceToWordIndices } from '@/lib/svoc-index-normalize';
import type { SvocSentenceData } from '@/lib/passage-analyzer-types';

interface AnalysisDoc {
  _id: ObjectId;
  fileName?: string;
  passageStates?: {
    main?: {
      sentences?: string[];
      svocData?: Record<string, SvocSentenceData>;
    };
  };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const db = await getDb('gomijoshua');
  const col = db.collection<AnalysisDoc>('passage_analyses');

  const cursor = col.find(
    { 'passageStates.main.svocData': { $exists: true, $ne: null } },
    {
      projection: {
        fileName: 1,
        'passageStates.main.sentences': 1,
        'passageStates.main.svocData': 1,
      },
    }
  );

  let scannedDocs = 0;
  let charBasedDocs = 0;
  let updatedDocs = 0;
  let scannedSentences = 0;
  let convertedSentences = 0;
  const sampleChanges: Array<{ fileName: string; sentIdx: number; before: SvocSentenceData; after: SvocSentenceData; sentence: string }> = [];

  for await (const doc of cursor) {
    scannedDocs++;
    const sentences = doc.passageStates?.main?.sentences ?? [];
    const svocData = doc.passageStates?.main?.svocData;
    if (!svocData || typeof svocData !== 'object') continue;

    const nextSvocData: Record<string, SvocSentenceData> = {};
    let anyConverted = false;

    for (const [key, sv] of Object.entries(svocData)) {
      const sentIdx = Number(key);
      if (!Number.isInteger(sentIdx)) {
        nextSvocData[key] = sv;
        continue;
      }
      scannedSentences++;
      const sentence = sentences[sentIdx] ?? '';
      const normalized = normalizeSvocSentenceToWordIndices(sv, sentence);
      // 진짜로 바뀐 경우만 카운트 (no-op 이면 동일 ref)
      const changed = normalized !== sv;
      if (changed) {
        convertedSentences++;
        anyConverted = true;
        if (sampleChanges.length < 5) {
          sampleChanges.push({
            fileName: doc.fileName ?? '',
            sentIdx,
            before: sv,
            after: normalized,
            sentence,
          });
        }
      }
      nextSvocData[key] = normalized;
    }

    if (anyConverted) {
      charBasedDocs++;
      if (apply) {
        await col.updateOne(
          { _id: doc._id },
          {
            $set: {
              'passageStates.main.svocData': nextSvocData,
              updated_at: new Date(),
            },
          }
        );
        updatedDocs++;
      }
    }
  }

  console.log('\n===== SVOC char→word 마이그레이션 결과 =====');
  console.log(`스캔된 passage_analyses 문서 수: ${scannedDocs}`);
  console.log(`char-based entry 가 1개 이상이던 문서 수: ${charBasedDocs}`);
  console.log(`스캔된 svocData entry (sentence) 총합: ${scannedSentences}`);
  console.log(`변환된 entry (sentence) 총합: ${convertedSentences}`);
  if (apply) {
    console.log(`업데이트된 문서 수: ${updatedDocs}`);
  } else {
    console.log(`(dry-run — 변경 안 함. --apply 로 실제 update)`);
  }

  if (sampleChanges.length > 0) {
    console.log('\n----- 변환 샘플 (최대 5건) -----');
    for (const c of sampleChanges) {
      console.log(`\n[${c.fileName}] sentenceIdx=${c.sentIdx}`);
      console.log(`  sentence: ${c.sentence}`);
      console.log(`  before: S=${c.before.subjectStart}~${c.before.subjectEnd}  V=${c.before.verbStart}~${c.before.verbEnd}`);
      console.log(`  after : S=${c.after.subjectStart}~${c.after.subjectEnd}  V=${c.after.verbStart}~${c.after.verbEnd}`);
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
