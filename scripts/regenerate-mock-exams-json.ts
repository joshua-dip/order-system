/**
 * app/data/mock-exams.json 을 passages.textbook 표기와 일치하도록 변환합니다.
 *
 * 변환 규칙
 *   - "고1_2026_03월(서울시)"           → "26년 3월 고1 영어모의고사"
 *   - "고1_2023_11월(경기도)[12월시행]"  → "23년 11월 고1 영어모의고사" (월 시행 메모도 제거)
 *   - "고2_2013_06월_A형(서울시)"        → 현재 passages 에 표준화 안 된 형태이므로 그대로 유지
 *   - "수능_2024_11월_2025수능(평가원)"  → 그대로 유지 (대수능 항목은 후속 작업으로)
 *
 * passages 에만 존재하는 신표기 키가 있으면 학년별로 추가합니다 (드물지만 안전망).
 *
 *   드라이런 (기본):
 *     DOTENV_CONFIG_PATH=.env.local npx tsx scripts/regenerate-mock-exams-json.ts
 *
 *   실제 적용:
 *     DOTENV_CONFIG_PATH=.env.local npx tsx scripts/regenerate-mock-exams-json.ts --apply
 */
import { config } from 'dotenv';
config({ path: process.env.DOTENV_CONFIG_PATH || '.env.local' });

import { promises as fs } from 'fs';
import path from 'path';
import { getDb } from '../lib/mongodb';
import { parseMockExamKey } from '../lib/mock-exam-key';
import { stripRegionFromMockExamTextbookKey } from '../lib/mock-exam-strip-region';

const APPLY = process.argv.includes('--apply');
const TARGET_PATH = path.resolve(process.cwd(), 'app/data/mock-exams.json');

type GradeKey = '고1모의고사' | '고2모의고사' | '고3모의고사' | '대수능';

interface MockExamsJson {
  고1모의고사: string[];
  고2모의고사: string[];
  고3모의고사: string[];
  대수능: string[];
  [k: string]: string[];
}

/** 옛 표기 → 신표기. 변환 불가능하면 원본 그대로. */
function convertKey(key: string): string {
  const parsed = parseMockExamKey(key);
  if (!parsed) return key;
  if (parsed.format !== 'old') return key;
  if (!parsed.grade || parsed.year == null || parsed.month == null) return key;
  // A/B형은 passages 가 아직 표준화 안 됨 → 그대로 둠
  if (parsed.variant) return key;
  const yy = String(parsed.year % 100).padStart(2, '0');
  const head = `${yy}년 ${parsed.month}월 ${parsed.grade} 영어모의고사`;
  if (parsed.bracketNote) {
    return stripRegionFromMockExamTextbookKey(`${head} (${parsed.bracketNote})`);
  }
  return head;
}

/** 학년 분류용 — 신표기 grade 우선, 옛 표기는 grade 그대로, 그 외는 null */
function classifyGrade(key: string): '고1' | '고2' | '고3' | null {
  return parseMockExamKey(key)?.grade ?? null;
}

function sortKeys(keys: string[]): string[] {
  return [...new Set(keys)].sort((a, b) => {
    const pa = parseMockExamKey(a);
    const pb = parseMockExamKey(b);
    const ya = pa?.year ?? 0;
    const yb = pb?.year ?? 0;
    if (ya !== yb) return yb - ya;
    const ma = pa?.month ?? 0;
    const mb = pb?.month ?? 0;
    if (ma !== mb) return mb - ma;
    const va = pa?.variant ?? '';
    const vb = pb?.variant ?? '';
    if (va !== vb) return vb.localeCompare(va);
    return b.localeCompare(a);
  });
}

async function main() {
  const existingTxt = await fs.readFile(TARGET_PATH, 'utf-8');
  const existing = JSON.parse(existingTxt) as MockExamsJson;

  const next: MockExamsJson = {
    고1모의고사: [],
    고2모의고사: [],
    고3모의고사: [],
    대수능: [...(existing.대수능 ?? [])], // 대수능은 이번 회차에서 손대지 않음
  };

  const conversions: { from: string; to: string }[] = [];

  for (const k of ['고1모의고사', '고2모의고사', '고3모의고사'] as GradeKey[]) {
    const list = existing[k] ?? [];
    const out: string[] = [];
    for (const orig of list) {
      const conv = convertKey(orig);
      const normalized = stripRegionFromMockExamTextbookKey(conv);
      if (normalized !== orig) conversions.push({ from: orig, to: normalized });
      out.push(normalized);
    }
    next[k] = out;
  }

  // passages.textbook 에서 신표기 키 보강
  const db = await getDb('gomijoshua');
  const passagesNew = (await db.collection('passages').distinct('textbook', {
    textbook: { $regex: '^\\d{2}년 \\d{1,2}월 고[123] 영어모의고사' },
  })) as string[];

  const augmentations: { grade: GradeKey; key: string }[] = [];
  for (const tb of passagesNew) {
    const grade = classifyGrade(tb);
    if (!grade) continue;
    const bucket: GradeKey =
      grade === '고1' ? '고1모의고사' : grade === '고2' ? '고2모의고사' : '고3모의고사';
    if (!next[bucket].includes(tb)) {
      next[bucket].push(tb);
      augmentations.push({ grade: bucket, key: tb });
    }
  }

  next.고1모의고사 = sortKeys(next.고1모의고사);
  next.고2모의고사 = sortKeys(next.고2모의고사);
  next.고3모의고사 = sortKeys(next.고3모의고사);
  // 대수능은 기존 정렬 유지

  console.log('───────────────────────────────────────────────');
  console.log(`${APPLY ? '적용' : '드라이런'} · ${TARGET_PATH}`);
  console.log('───────────────────────────────────────────────');
  console.log(`\n변환 (옛 → 신): ${conversions.length}건`);
  for (const c of conversions) console.log(`  ${c.from}  →  ${c.to}`);

  if (augmentations.length > 0) {
    console.log(`\npassages 에서 추가 보강: ${augmentations.length}건`);
    for (const a of augmentations) console.log(`  + ${a.grade}  ${a.key}`);
  } else {
    console.log('\n추가 보강 없음.');
  }

  for (const k of ['고1모의고사', '고2모의고사', '고3모의고사', '대수능'] as GradeKey[]) {
    const before = (existing[k] ?? []).length;
    const after = next[k].length;
    console.log(`  · ${k}  ${before} → ${after}`);
  }

  if (!APPLY) {
    console.log('\n드라이런 종료. 실제 적용은 --apply 플래그를 추가하세요.');
    return;
  }

  await fs.writeFile(TARGET_PATH, JSON.stringify(next, null, 2) + '\n', 'utf-8');
  console.log(`\n✓ ${TARGET_PATH} 갱신 완료`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
