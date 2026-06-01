/**
 * passage_analyses 의 svocData 실제 저장 구조 + 다른 분석 필드 (syntaxPhrases, grammarTags) 와
 * 비교해 모델 확장 방향 검토.
 *
 * 샘플 3 passage:
 *  - 19번 (방금 정리, char→word 변환 후) : 등위접속 sentence 있음
 *  - 26년 3월 고1 18번 : 깨끗한 word-index 데이터
 *  - random 한 개 더
 *
 * 실행: MONGODB_URI="..." npx tsx scripts/qna-inspect-svoc-shape.ts
 */

import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { passageAnalysisFileNameForPassageId } from '@/lib/passage-analyzer-types';

const SAMPLE_IDS = [
  { id: '69fe3e8d36e33281b7111f79', label: '26년 5월 고3 19번 (등위접속 포함)' },
  { id: '69c2dd9846f58f933b6dccea', label: '26년 3월 고1 18번 (정렬 정상)' },
];

function pretty(obj: unknown, indent = 0): string {
  if (obj === null || obj === undefined) return String(obj);
  if (typeof obj !== 'object') return JSON.stringify(obj);
  const pad = ' '.repeat(indent);
  const isArr = Array.isArray(obj);
  if (isArr) {
    if ((obj as unknown[]).length === 0) return '[]';
    const items = (obj as unknown[]).slice(0, 3).map((v) => pretty(v, indent + 2));
    const more = (obj as unknown[]).length > 3 ? `\n${pad}  …+${(obj as unknown[]).length - 3} more` : '';
    return `[\n${pad}  ${items.join(`,\n${pad}  `)}${more}\n${pad}]`;
  }
  const keys = Object.keys(obj as Record<string, unknown>);
  if (keys.length === 0) return '{}';
  const lines = keys.map((k) => `${k}: ${pretty((obj as Record<string, unknown>)[k], indent + 2)}`);
  return `{\n${pad}  ${lines.join(`,\n${pad}  `)}\n${pad}}`;
}

async function inspectOne(passageId: string, label: string) {
  const db = await getDb('gomijoshua');
  console.log('\n' + '='.repeat(80));
  console.log(`📘 ${label}  (id=${passageId})`);
  console.log('='.repeat(80));

  const analysis = await db.collection('passage_analyses').findOne(
    { fileName: passageAnalysisFileNameForPassageId(passageId) },
    {
      projection: {
        'passageStates.main.sentences': 1,
        'passageStates.main.svocData': 1,
        'passageStates.main.syntaxPhrases': 1,
        'passageStates.main.grammarTags': 1,
        'passageStates.main.sentenceBreaks': 1,
      },
    }
  );
  if (!analysis) {
    console.log('passage_analyses NOT FOUND');
    return;
  }
  const main = (analysis as {
    passageStates?: {
      main?: {
        sentences?: string[];
        svocData?: Record<string, unknown>;
        syntaxPhrases?: Record<string, unknown[]>;
        grammarTags?: unknown[];
        sentenceBreaks?: Record<string, number[]>;
      };
    };
  }).passageStates?.main;

  // 1) sentences 개수
  console.log(`\n[1] sentences: ${main?.sentences?.length ?? 0} 개`);

  // 2) svocData 전체 키 + 1개 샘플 raw
  if (main?.svocData) {
    const keys = Object.keys(main.svocData);
    console.log(`\n[2] svocData (Record<number, SvocSentenceData>) — 총 ${keys.length} sentence`);
    const sampleKey = keys[0];
    console.log(`샘플 svocData[${sampleKey}] raw:`);
    console.log(pretty(main.svocData[sampleKey], 0));
  } else {
    console.log('\n[2] svocData: 없음');
  }

  // 3) syntaxPhrases — Array 구조인지 확인 (한 sentence 안에 여러 phrase)
  if (main?.syntaxPhrases) {
    const keys = Object.keys(main.syntaxPhrases);
    console.log(`\n[3] syntaxPhrases (Record<number, SyntaxPhraseStored[]>) — 총 ${keys.length} sentence`);
    const sampleKey = keys.find((k) => Array.isArray(main.syntaxPhrases![k]) && (main.syntaxPhrases![k] as unknown[]).length > 1) || keys[0];
    if (sampleKey) {
      const list = main.syntaxPhrases[sampleKey] as unknown[];
      console.log(`샘플 syntaxPhrases[${sampleKey}] (${list.length} 개):`);
      console.log(pretty(list, 0));
    }
  } else {
    console.log('\n[3] syntaxPhrases: 없음');
  }

  // 4) grammarTags — sentence 단위 Array 안에 multiple 태그
  if (main?.grammarTags) {
    const tags = main.grammarTags as Array<Record<string, unknown>>;
    const bySentence = new Map<number, number>();
    for (const t of tags) {
      const si = Number(t.sentenceIndex);
      if (Number.isFinite(si)) bySentence.set(si, (bySentence.get(si) ?? 0) + 1);
    }
    console.log(`\n[4] grammarTags (Array, ${tags.length} 개) — sentence별 count: ${JSON.stringify(Array.from(bySentence.entries()).slice(0, 8))}…`);
    if (tags.length > 0) {
      console.log('샘플 grammarTags[0]:');
      console.log(pretty(tags[0], 0));
    }
  } else {
    console.log('\n[4] grammarTags: 없음');
  }

  // 5) sentenceBreaks — 끊어읽기 (한 sentence 안 여러 cut)
  if (main?.sentenceBreaks) {
    const keys = Object.keys(main.sentenceBreaks);
    console.log(`\n[5] sentenceBreaks (Record<number, number[]>) — 총 ${keys.length} sentence`);
    const sampleKey = keys[0];
    if (sampleKey) {
      console.log(`샘플 sentenceBreaks[${sampleKey}]:`, main.sentenceBreaks[sampleKey]);
    }
  } else {
    console.log('\n[5] sentenceBreaks: 없음');
  }

  // 6) 등위접속 sentence(17번) svocData 만 직접 출력
  if (main?.svocData && '17' in main.svocData) {
    console.log(`\n[6] 19번 의 sentences[17] 「Paul's heart raced, and his hands grew sweaty.」 의 svocData:`);
    console.log(pretty(main.svocData['17'], 0));
  }
  // 정상 데이터의 한 sentence 도 비교
  if (main?.svocData && '5' in main.svocData) {
    console.log(`\n[7] svocData[5] 비교:`);
    console.log(pretty(main.svocData['5'], 0));
  }
}

async function main() {
  for (const s of SAMPLE_IDS) {
    await inspectOne(s.id, s.label);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
