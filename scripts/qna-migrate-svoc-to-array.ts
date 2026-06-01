/**
 * passage_analyses 전수: svocData[si] 가 단일 객체면 [객체] 로 wrap (이미 array 면 skip).
 * 다절 SVOC 지원의 인프라 정리 — 모든 데이터를 일관된 array shape 으로.
 *
 * 사용:
 *   dry-run:  MONGODB_URI="..." npx tsx scripts/qna-migrate-svoc-to-array.ts
 *   apply:    MONGODB_URI="..." npx tsx scripts/qna-migrate-svoc-to-array.ts --apply
 */

import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import type { SvocSentenceData } from '@/lib/passage-analyzer-types';

interface AnalysisDoc {
  _id: ObjectId;
  fileName?: string;
  passageStates?: {
    main?: {
      svocData?: Record<string, SvocSentenceData | SvocSentenceData[]>;
    };
  };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const db = await getDb('gomijoshua');
  const col = db.collection<AnalysisDoc>('passage_analyses');

  const cursor = col.find(
    { 'passageStates.main.svocData': { $exists: true, $ne: null } },
    { projection: { fileName: 1, 'passageStates.main.svocData': 1 } }
  );

  let scannedDocs = 0;
  let docsNeedingWrap = 0;
  let updatedDocs = 0;
  let entriesWrapped = 0;
  let entriesAlreadyArray = 0;

  for await (const doc of cursor) {
    scannedDocs++;
    const svocData = doc.passageStates?.main?.svocData;
    if (!svocData || typeof svocData !== 'object') continue;

    const next: Record<string, SvocSentenceData[]> = {};
    let needsWrap = false;

    for (const [key, v] of Object.entries(svocData)) {
      if (Array.isArray(v)) {
        entriesAlreadyArray++;
        next[key] = v;
      } else if (v && typeof v === 'object') {
        entriesWrapped++;
        next[key] = [v as SvocSentenceData];
        needsWrap = true;
      }
    }

    if (needsWrap) {
      docsNeedingWrap++;
      if (apply) {
        await col.updateOne(
          { _id: doc._id },
          {
            $set: {
              'passageStates.main.svocData': next,
              updated_at: new Date(),
            },
          }
        );
        updatedDocs++;
      }
    }
  }

  console.log('\n===== svocData single → [single] wrap 마이그레이션 =====');
  console.log(`스캔된 문서: ${scannedDocs}`);
  console.log(`wrap 필요 문서: ${docsNeedingWrap}`);
  console.log(`entry 통계: 이미 array=${entriesAlreadyArray}, wrap=${entriesWrapped}`);
  if (apply) {
    console.log(`업데이트된 문서: ${updatedDocs}`);
  } else {
    console.log('(dry-run — --apply 로 실제 적용)');
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
