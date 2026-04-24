/**
 * passages, generated_questions, narrative_questions, textbook_links의
 * textbook 필드 연도/순서 정규화.
 *
 * 규칙 1: "2014 11월 고1 영어모의고사" → "14년 11월 고1 영어모의고사"
 * 규칙 2: "고1 22년 9월 영어모의고사" → "22년 9월 고1 영어모의고사"
 *
 * 사용:
 *   npx tsx scripts/normalize-textbook-year.ts           (dry-run, 변경 미리보기)
 *   npx tsx scripts/normalize-textbook-year.ts --apply   (실제 적용)
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { getDb } from '@/lib/mongodb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.join(PROJECT_ROOT, '.env') });
config({ path: path.join(PROJECT_ROOT, '.env.local') });

const APPLY = process.argv.includes('--apply');

/**
 * "20XX \d+월" 또는 "19XX \d+월" 형태를 "XX년 \d+월"으로 변환.
 * 월(月) 앞에 오는 연도만 변환하므로 "2026 올림포스..." 같은 제목은 건너뜀.
 */
function convertYear(s: string): string {
  return s.replace(/\b(19|20)(\d{2}) (?=\d+월)/g, '$2년 ');
}

/**
 * "고N YY년 MM월 ..." → "YY년 MM월 고N ..."
 * 예: "고1 22년 9월 영어모의고사" → "22년 9월 고1 영어모의고사"
 */
function reorderGradeYear(s: string): string {
  return s.replace(/^(고\d+) (\d+년 \d+월 )/, '$2$1 ');
}

/** 두 변환을 순서대로 적용 */
function normalizeTextbook(s: string): string {
  return reorderGradeYear(convertYear(s));
}

function needsConvert(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  return /\b(19|20)\d{2} \d+월/.test(s) || /^고\d+ \d+년 \d+월/.test(s);
}

async function main() {
  const db = await getDb('gomijoshua');
  console.log(`모드: ${APPLY ? '실제 적용 (--apply)' : '미리보기 (dry-run)'}\n`);

  let totalUpdated = 0;

  // ── 1. passages.textbook ──────────────────────────────────────
  {
    const col = db.collection('passages');
    const docs = await col
      .find({ $or: [{ textbook: { $regex: '^(19|20)\\d{2} \\d+월' } }, { textbook: { $regex: '^고\\d+ \\d+년 \\d+월' } }] })
      .project({ _id: 1, textbook: 1 })
      .toArray();

    console.log(`[passages] 대상 ${docs.length}개`);
    const renameMap = new Map<string, string>();
    for (const d of docs) {
      const old = String(d.textbook);
      const next = normalizeTextbook(old);
      if (old !== next && !renameMap.has(old)) {
        renameMap.set(old, next);
        console.log(`  "${old}" → "${next}"`);
      }
    }

    if (APPLY && renameMap.size > 0) {
      for (const [old, next] of renameMap) {
        const r = await col.updateMany({ textbook: old }, { $set: { textbook: next } });
        console.log(`  ✓ passages "${old}" → ${r.modifiedCount}개 수정`);
        totalUpdated += r.modifiedCount;
      }
    }
    console.log();
  }

  // ── 2. generated_questions.textbook + source ──────────────────
  {
    const col = db.collection('generated_questions');

    // textbook 필드
    const byTextbook = await col
      .find({ $or: [{ textbook: { $regex: '^(19|20)\\d{2} \\d+월' } }, { textbook: { $regex: '^고\\d+ \\d+년 \\d+월' } }] })
      .project({ _id: 1, textbook: 1 })
      .toArray();
    const tbMap = new Map<string, string>();
    for (const d of byTextbook) {
      const old = String(d.textbook);
      if (!tbMap.has(old)) tbMap.set(old, normalizeTextbook(old));
    }
    console.log(`[generated_questions.textbook] 대상 교재 ${tbMap.size}종 (문서 ${byTextbook.length}개)`);
    for (const [old, next] of tbMap) console.log(`  "${old}" → "${next}"`);

    if (APPLY && tbMap.size > 0) {
      for (const [old, next] of tbMap) {
        const r = await col.updateMany({ textbook: old }, { $set: { textbook: next } });
        console.log(`  ✓ generated_questions.textbook "${old}" → ${r.modifiedCount}개 수정`);
        totalUpdated += r.modifiedCount;
      }
    }

    // source 필드 (교재명이 source에도 포함된 경우)
    const bySource = await col
      .find({ $or: [{ source: { $regex: '(19|20)\\d{2} \\d+월' } }, { source: { $regex: '^고\\d+ \\d+년 \\d+월' } }] })
      .project({ _id: 1, source: 1 })
      .toArray();
    const srcMap = new Map<string, string>();
    for (const d of bySource) {
      const old = String(d.source);
      const next = normalizeTextbook(old);
      if (old !== next && !srcMap.has(old)) srcMap.set(old, next);
    }
    console.log(`\n[generated_questions.source] 대상 ${bySource.length}개`);
    for (const [old, next] of srcMap) console.log(`  "${old}" → "${next}"`);

    if (APPLY && srcMap.size > 0) {
      for (const [old, next] of srcMap) {
        const r = await col.updateMany({ source: old }, { $set: { source: next } });
        console.log(`  ✓ generated_questions.source "${old}" → ${r.modifiedCount}개 수정`);
        totalUpdated += r.modifiedCount;
      }
    }
    console.log();
  }

  // ── 3. narrative_questions.textbook ──────────────────────────
  {
    const col = db.collection('narrative_questions');
    const docs = await col
      .find({ $or: [{ textbook: { $regex: '^(19|20)\\d{2} \\d+월' } }, { textbook: { $regex: '^고\\d+ \\d+년 \\d+월' } }] })
      .project({ _id: 1, textbook: 1 })
      .toArray();
    const tbMap = new Map<string, string>();
    for (const d of docs) {
      const old = String(d.textbook);
      if (!tbMap.has(old)) tbMap.set(old, normalizeTextbook(old));
    }
    console.log(`[narrative_questions.textbook] 대상 교재 ${tbMap.size}종 (문서 ${docs.length}개)`);
    for (const [old, next] of tbMap) console.log(`  "${old}" → "${next}"`);

    if (APPLY && tbMap.size > 0) {
      for (const [old, next] of tbMap) {
        const r = await col.updateMany({ textbook: old }, { $set: { textbook: next } });
        console.log(`  ✓ narrative_questions "${old}" → ${r.modifiedCount}개 수정`);
        totalUpdated += r.modifiedCount;
      }
    }
    console.log();
  }

  // ── 4. textbook_links.textbookKey ────────────────────────────
  {
    const col = db.collection('textbook_links');
    const docs = await col
      .find({ $or: [{ textbookKey: { $regex: '^(19|20)\\d{2} \\d+월' } }, { textbookKey: { $regex: '^고\\d+ \\d+년 \\d+월' } }] })
      .project({ _id: 1, textbookKey: 1 })
      .toArray();
    console.log(`[textbook_links.textbookKey] 대상 ${docs.length}개`);
    for (const d of docs) {
      const old = String(d.textbookKey);
      console.log(`  "${old}" → "${normalizeTextbook(old)}"`);
    }

    if (APPLY && docs.length > 0) {
      for (const d of docs) {
        const old = String(d.textbookKey);
        const next = normalizeTextbook(old);
        const r = await col.updateOne({ _id: d._id }, { $set: { textbookKey: next } });
        console.log(`  ✓ textbook_links "${old}" → ${r.modifiedCount}개 수정`);
        totalUpdated += r.modifiedCount;
      }
    }
    console.log();
  }

  // ── 5. passages.source_key (연도 포함된 경우) ─────────────────
  {
    const col = db.collection('passages');
    const docs = await col
      .find({ $or: [{ source_key: { $regex: '(19|20)\\d{2} \\d+월' } }, { source_key: { $regex: '^고\\d+ \\d+년 \\d+월' } }] })
      .project({ _id: 1, source_key: 1 })
      .toArray();
    const skMap = new Map<string, string>();
    for (const d of docs) {
      const old = String(d.source_key);
      const next = normalizeTextbook(old);
      if (old !== next && !skMap.has(old)) skMap.set(old, next);
    }
    console.log(`[passages.source_key] 대상 ${docs.length}개 (변환 대상 ${skMap.size}종)`);
    for (const [old, next] of skMap) console.log(`  "${old}" → "${next}"`);

    if (APPLY && skMap.size > 0) {
      for (const [old, next] of skMap) {
        const r = await col.updateMany({ source_key: old }, { $set: { source_key: next } });
        console.log(`  ✓ passages.source_key "${old}" → ${r.modifiedCount}개 수정`);
        totalUpdated += r.modifiedCount;
      }
    }
    console.log();
  }

  if (APPLY) {
    console.log(`\n✅ 완료 — 총 ${totalUpdated}개 문서 수정`);
  } else {
    console.log('\n⚠️  dry-run 완료. 실제 적용하려면 --apply 옵션을 추가하세요.');
    console.log('  npx tsx scripts/normalize-textbook-year.ts --apply');
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
