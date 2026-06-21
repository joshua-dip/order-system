/**
 * 어휘(문맥) 변형문제 — 선택지 괄호 맥락 제거 (수능형 정렬).
 *
 * 일부 어휘 문항은 선택지가 `① extensive (due to its extensive usage and adoption)`
 * 처럼 단어 뒤에 본문 맥락을 괄호로 달고 있다. 수능 어휘(문맥) 문제는 선택지가
 * 단어만 제시되므로, 괄호 부분을 제거해 `① extensive ### ② isolation ### ...` 로 정규화한다.
 *
 * 대상: generated_questions 중 type 에 '어휘' 포함 + option_type 이 Korean 이 아님
 *       + question_data.Options 에 '(' 가 들어 있는 문항.
 * 보호: Korean 선택지 버전은 건드리지 않는다 (의도적 한글본).
 *
 * 가드(아래 모두 만족할 때만 수정):
 *   - '###' 로 split 한 청크 수가 보존되고 각 청크가 ①②③④⑤ 로 시작
 *   - 괄호 제거 후 결과가 원본과 다르고, 더 이상 '(' / ')' 가 없음
 *   - CorrectAnswer(동그라미 번호)는 변하지 않음 (Options 만 수정)
 *
 * 사용:
 *   npx tsx scripts/patch-vocab-strip-paren-options.ts                 # 전체 survey (dry-run)
 *   npx tsx scripts/patch-vocab-strip-paren-options.ts --textbook "공통영어1_YBM박준언"
 *   npx tsx scripts/patch-vocab-strip-paren-options.ts --apply         # 실제 수정
 *   ... --apply --textbook "공통영어1_YBM박준언"                        # 교재 한정 수정
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.join(PROJECT_ROOT, '.env') });
config({ path: path.join(PROJECT_ROOT, '.env.local') });

const APPLY = process.argv.includes('--apply');
const tbIdx = process.argv.indexOf('--textbook');
const TEXTBOOK = tbIdx >= 0 ? process.argv[tbIdx + 1] : null;

const CIRCLED = /^[①②③④⑤⑥⑦⑧⑨⑩]/u;

/** 한 선택지 청크에서 괄호 맥락 제거 + 공백 정규화. */
function stripParenChunk(chunk: string): string {
  return chunk
    .replace(/\([^()]*\)/g, '') // 단일 레벨 괄호 제거
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Options 문자열에서 각 선택지의 괄호 맥락 제거.
 * 변환 불가/불안전하면 null 반환(수정 안 함).
 */
function stripParenOptions(options: string): string | null {
  if (!options.includes('(')) return null;
  if (!options.includes('###')) return null; // 예상 밖 포맷 — 건너뜀
  const chunks = options.split('###').map((c) => c.trim()).filter(Boolean);
  if (chunks.length < 2) return null;
  const stripped = chunks.map(stripParenChunk);
  // 가드: 각 청크가 동그라미 번호로 시작하고 비어있지 않아야 함
  if (!stripped.every((c) => c.length > 0 && CIRCLED.test(c))) return null;
  const next = stripped.join(' ### ');
  if (next.includes('(') || next.includes(')')) return null; // 잔여 괄호 — 안전상 건너뜀
  if (next === options.trim()) return null; // 변화 없음
  return next;
}

async function main() {
  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');

  const query: Record<string, unknown> = {
    type: { $regex: '어휘' },
    'question_data.Options': { $regex: '\\(' },
  };
  if (TEXTBOOK) query.textbook = TEXTBOOK;

  const docs = await col.find(query).toArray();

  const byTextbook = new Map<string, number>();
  const typesSeen = new Set<string>();
  let skippedKorean = 0;
  let skippedUnsafe = 0;
  let updated = 0;

  /* 1) 변환 대상 수집 (수정 전) */
  const changes: Array<{ id: string; serialNo: unknown; textbook: string; source: unknown; type: unknown; before: string; after: string }> = [];
  for (const doc of docs) {
    const qd = (doc.question_data ?? {}) as Record<string, unknown>;
    const optType = String(doc.option_type ?? qd.OptionType ?? '').trim();
    if (optType === 'Korean') {
      skippedKorean += 1;
      continue;
    }
    const options = String(qd.Options ?? '');
    const next = stripParenOptions(options);
    if (next == null) {
      // '(' 는 있으나 안전 변환 불가(또는 괄호가 마커 밖에만 있는 등)
      skippedUnsafe += 1;
      continue;
    }
    const tb = String(doc.textbook ?? '');
    typesSeen.add(String(doc.type ?? ''));
    byTextbook.set(tb, (byTextbook.get(tb) ?? 0) + 1);
    changes.push({
      id: String(doc._id),
      serialNo: doc.serialNo ?? null,
      textbook: tb,
      source: doc.source ?? '',
      type: doc.type ?? '',
      before: options.trim(),
      after: next,
    });
  }

  /* 2) APPLY 시 — 백업 먼저 기록(원복용) 후 일괄 수정 */
  let backupPath: string | null = null;
  if (APPLY && changes.length > 0) {
    const dir = path.join(PROJECT_ROOT, 'scripts', '.backups');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    backupPath = path.join(dir, `vocab-strip-paren-${stamp}.json`);
    fs.writeFileSync(backupPath, JSON.stringify({ textbookFilter: TEXTBOOK ?? '(전체)', changes }, null, 2), 'utf8');

    for (const c of changes) {
      const r = await col.updateOne(
        { _id: new ObjectId(c.id), 'question_data.Options': c.before },
        { $set: { 'question_data.Options': c.after } },
      );
      updated += r.modifiedCount;
    }
  }

  const samples = changes.slice(0, 12).map((c) => ({
    serialNo: c.serialNo,
    textbook: c.textbook,
    source: c.source,
    type: c.type,
    before: c.before,
    after: c.after,
  }));
  const candidates = changes.length;

  console.log(
    JSON.stringify(
      {
        ok: true,
        apply: APPLY,
        textbookFilter: TEXTBOOK ?? '(전체)',
        matched_with_paren: docs.length,
        candidates_to_fix: candidates,
        skipped_korean: skippedKorean,
        skipped_unsafe: skippedUnsafe,
        updated,
        backupPath,
        types_seen: [...typesSeen],
        by_textbook: Object.fromEntries([...byTextbook.entries()].sort((a, b) => b[1] - a[1])),
        samples,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
