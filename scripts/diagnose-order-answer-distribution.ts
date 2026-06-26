/**
 * 주문(또는 임의 지문 집합)의 변형문제 정답 번호(①~⑤) 분포 진단 — read-only.
 *
 * 실행: npm run cc:variant -- (X) — 이 파일은 직접 tsx 로 실행
 *   npx tsx scripts/diagnose-order-answer-distribution.ts MV-20260623-001
 *
 * 주문번호를 주면 orders.orderNumber 로 찾아 mockVariant/bookVariant 매칭 지문을 쓰지 않고,
 * 단순화를 위해 인자로 받은 passageIds(또는 아래 기본값)로 generated_questions 를 집계한다.
 * 정답이 ①에 쏠렸는지 유형별로 본다. 셔플 대상(주제·빈칸·요약·주장 등)과 비셔플(순서)을 구분 표시.
 */
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

// MV-20260623-001 (25년 6월 고3 영어모의고사) 의 매칭 지문 5개 (variant_get_shortage scopePassageIds)
const DEFAULT_PASSAGE_IDS = [
  '6a16b05dbab3d98365c345d8',
  '6a16adcebab3d98365c345bf',
  '6a16adcebab3d98365c345c0',
  '6a16adcebab3d98365c345c4',
  '6a16adcebab3d98365c345c7',
];

const SHUFFLABLE = new Set([
  '주제', '제목', '주장', '일치', '불일치', '함의', '함의-고난도',
  '빈칸', '빈칸-고난도', '요약', '요약-고난도',
  '주제-고난도', '제목-고난도', '주장-고난도', '일치-고난도', '불일치-고난도',
]);

const CIRCLED = ['①', '②', '③', '④', '⑤'] as const;

async function main() {
  const argIds = process.argv.slice(2).filter((s) => /^[0-9a-fA-F]{24}$/.test(s));
  const passageIds = (argIds.length ? argIds : DEFAULT_PASSAGE_IDS).map((s) => new ObjectId(s));

  const db = await getDb('gomijoshua');
  const docs = await db
    .collection('generated_questions')
    .find({ passage_id: { $in: passageIds } })
    .project({ type: 1, status: 1, option_type: 1, source_file: 1, passage_id: 1, 'question_data.CorrectAnswer': 1 })
    .toArray();

  console.log(`\n총 변형문제: ${docs.length}건 (지문 ${passageIds.length}개)\n`);

  // 유형별 집계
  type Row = { total: number; dist: Record<string, number>; nonCircle: number };
  const byType = new Map<string, Row>();
  let grand: Record<string, number> = { '①': 0, '②': 0, '③': 0, '④': 0, '⑤': 0 };
  let grandSingle = 0;

  for (const d of docs) {
    const type = String(d.type ?? '').trim();
    const ca = String((d.question_data as Record<string, unknown> | undefined)?.CorrectAnswer ?? '').trim();
    const row = byType.get(type) ?? { total: 0, dist: { '①': 0, '②': 0, '③': 0, '④': 0, '⑤': 0 }, nonCircle: 0 };
    row.total += 1;
    if (/^[①②③④⑤]$/.test(ca)) {
      row.dist[ca] += 1;
      grand[ca] += 1;
      grandSingle += 1;
    } else {
      row.nonCircle += 1; // 복수정답(어법-고난도 등) 또는 비정형
    }
    byType.set(type, row);
  }

  const types = [...byType.keys()].sort();
  const pad = (s: string, n: number) => s.padEnd(n);
  console.log(pad('유형', 18) + pad('셔플', 6) + pad('계', 4) + CIRCLED.map((c) => pad(c, 4)).join('') + '  ①비율  비고');
  console.log('-'.repeat(72));
  for (const type of types) {
    const r = byType.get(type)!;
    const single = CIRCLED.reduce((a, c) => a + r.dist[c], 0);
    const onePct = single ? Math.round((r.dist['①'] / single) * 1000) / 10 : 0;
    const shuf = SHUFFLABLE.has(type) ? '셔플O' : '셔플X';
    const note = r.nonCircle ? `복수/비정형 ${r.nonCircle}` : '';
    const flag = !SHUFFLABLE.has(type) && onePct >= 50 && single >= 2 ? '  ⚠️쏠림' : '';
    console.log(
      pad(type, 18) + pad(shuf, 6) + pad(String(r.total), 4) +
      CIRCLED.map((c) => pad(String(r.dist[c]), 4)).join('') +
      pad(`  ${onePct}%`, 8) + note + flag,
    );
  }
  console.log('-'.repeat(72));
  const grandPct = grandSingle ? Math.round((grand['①'] / grandSingle) * 1000) / 10 : 0;
  console.log(
    pad('전체(단일정답)', 24) + pad(String(grandSingle), 4) +
    CIRCLED.map((c) => pad(String(grand[c]), 4)).join('') + `  ①비율 ${grandPct}%`,
  );
  console.log('');

  // 셔플O 유형 중 ① 쏠림(≥50%)인 것 — option_type·status·source_file 분해
  console.log('=== 셔플O 쏠림 유형 상세 (option_type / status / source_file) ===');
  for (const type of types) {
    if (!SHUFFLABLE.has(type)) continue;
    const r = byType.get(type)!;
    const single = CIRCLED.reduce((a, c) => a + r.dist[c], 0);
    const onePct = single ? (r.dist['①'] / single) * 100 : 0;
    if (onePct < 50 || single < 2) continue;
    const sub = docs.filter((d) => String(d.type ?? '').trim() === type);
    const byOpt = new Map<string, number>();
    const byStatus = new Map<string, number>();
    const bySrc = new Map<string, number>();
    for (const d of sub) {
      const ca = String((d.question_data as Record<string, unknown> | undefined)?.CorrectAnswer ?? '').trim();
      if (ca !== '①') continue; // ① 인 것만 분해
      const opt = String(d.option_type ?? '').trim() || '(none)';
      const st = String(d.status ?? '').trim() || '(none)';
      const sf = String(d.source_file ?? '').trim() || '(none)';
      byOpt.set(opt, (byOpt.get(opt) ?? 0) + 1);
      byStatus.set(st, (byStatus.get(st) ?? 0) + 1);
      bySrc.set(sf, (bySrc.get(sf) ?? 0) + 1);
    }
    const fmt = (m: Map<string, number>) => [...m.entries()].map(([k, v]) => `${k}:${v}`).join(', ');
    console.log(`\n[${type}] ①=${r.dist['①']}/${single}`);
    console.log(`  option_type → ${fmt(byOpt)}`);
    console.log(`  status      → ${fmt(byStatus)}`);
    console.log(`  source_file → ${fmt(bySrc)}`);
  }
  console.log('');

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
