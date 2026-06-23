/**
 * 순서·삽입 변형문제 정답을 원문과 대조해 점검하기 위한 read-only 덤프 (DB 변경 없음).
 *
 * 실행:
 *   npm run cc:variant -- --help        # (참고)
 *   npx tsx scripts/inspect-variant-answers.ts --textbook "26년 6월 고1 영어모의고사" --type 순서
 *   npx tsx scripts/inspect-variant-answers.ts --textbook "26년 6월 고1 영어모의고사" --type 삽입
 *
 * 순서: audit 의 원문대조 로직을 재현하되, "unverifiable/mismatch" 건을 진단 사유 +
 *       (A/B/C 청크, 원문) 과 함께 출력해 수기 정답 판정이 가능하게 한다.
 * 삽입: 자동 정답검증이 없으므로 Question(삽입 문장)·Paragraph(①~⑤ 마커)·원문을 출력.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import {
  correctAnswerFromOwnOptions,
  parseOrderOptions,
  parseOrderParagraph,
} from '@/lib/order-variant-validation';

/** 구분자 무관 — (A)/(B)/(C) 라벨 기준으로 intro·A·B·C 분리 (단일 개행 포맷 대응) */
function parseOrderLoose(raw: string): { intro: string; A: string; B: string; C: string } | null {
  const std = parseOrderParagraph(raw);
  if (std) return std;
  const aIdx = raw.search(/\(A\)/);
  const bIdx = raw.search(/\(B\)/);
  const cIdx = raw.search(/\(C\)/);
  if (aIdx < 0 || bIdx < 0 || cIdx < 0 || !(aIdx < bIdx && bIdx < cIdx)) return null;
  return {
    intro: raw.slice(0, aIdx).trim(),
    A: raw.slice(aIdx + 3, bIdx).trim(),
    B: raw.slice(bIdx + 3, cIdx).trim(),
    C: raw.slice(cIdx + 3).trim(),
  };
}

const norm = (s: string) => s.replace(/[^a-z0-9]+/gi, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
const PERMS: Array<['A' | 'B' | 'C', 'A' | 'B' | 'C', 'A' | 'B' | 'C']> = [
  ['A', 'B', 'C'], ['A', 'C', 'B'], ['B', 'A', 'C'],
  ['B', 'C', 'A'], ['C', 'A', 'B'], ['C', 'B', 'A'],
];

/**
 * 5개(+ABC) 순열을 직접 조립해 원문(prefix)과 대조.
 * 비연속 청크면 어떤 순열도 안 맞아 null → 자동검증 불가(원문 정렬 무의미).
 */
function verifyOrderByAssembly(
  parts: { intro: string; A: string; B: string; C: string },
  original: string,
): { perm: string; isIdentity: boolean } | null {
  const o = norm(original);
  for (const [x, y, z] of PERMS) {
    const assembled = norm(`${parts.intro} ${parts[x]} ${parts[y]} ${parts[z]}`);
    if (assembled.length < 20) continue;
    if (o.startsWith(assembled) || o.includes(assembled)) {
      return { perm: `(${x})-(${y})-(${z})`, isIdentity: x === 'A' && y === 'B' && z === 'C' };
    }
  }
  return null;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.join(PROJECT_ROOT, '.env') });
config({ path: path.join(PROJECT_ROOT, '.env.local') });

function getFlag(name: string): string {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : '';
}

async function main() {
  const textbook = getFlag('textbook').trim();
  const typeArg = getFlag('type').trim(); // '순서' | '삽입' | ''(둘 다)
  if (!textbook) {
    console.error('사용법: npx tsx scripts/inspect-variant-answers.ts --textbook "교재명" [--type 순서|삽입]');
    process.exit(1);
  }
  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');
  const passagesCol = db.collection('passages');

  const wantOrder = !typeArg || typeArg === '순서';
  const wantInsert = !typeArg || typeArg === '삽입';

  const types: string[] = [];
  if (wantOrder) types.push('순서', '순서-고난도');
  if (wantInsert) types.push('삽입', '삽입-고난도');

  const docs = await col
    .find({ textbook, deleted_at: null, type: { $in: types } })
    .sort({ type: 1, source: 1 })
    .toArray();

  // 원문 로드
  const passageIds = [...new Set(docs.map((d) => String(d.passage_id)).filter((s) => ObjectId.isValid(s)))];
  const passageMap = new Map<string, string>();
  if (passageIds.length > 0) {
    const passages = await passagesCol
      .find({ _id: { $in: passageIds.map((id) => new ObjectId(id)) } })
      .project({ 'content.original': 1 })
      .toArray();
    for (const p of passages) {
      const orig = (p.content as Record<string, unknown> | undefined)?.original;
      if (typeof orig === 'string') passageMap.set(String(p._id), orig);
    }
  }

  const sep = '═'.repeat(80);

  // ── 순서 ──
  if (wantOrder) {
    const orderDocs = docs.filter((d) => ['순서', '순서-고난도'].includes(String(d.type ?? '')));
    let okCount = 0;
    const mismatches: string[] = [];
    const unshuffled: string[] = [];
    const uncheckable: string[] = [];
    for (const d of orderDocs) {
      const qd = (d.question_data ?? {}) as Record<string, unknown>;
      const source = String(d.source ?? '');
      const ca = String(qd.CorrectAnswer ?? '').trim();
      const paragraph = String(qd.Paragraph ?? '');
      const parsed = parseOrderLoose(paragraph);
      const original = passageMap.get(String(d.passage_id));
      const optionLayout = parseOrderOptions(qd.Options);

      const block = (tag: string, extra: string) => {
        const lines = [sep, `[순서] ${source}   id=${String(d._id)}   저장정답=${ca || '(없음)'}  ${tag}`];
        if (extra) lines.push(extra);
        lines.push(`Options: ${optionLayout.join(' | ')}`);
        if (parsed) {
          lines.push(`― intro: ${parsed.intro}`);
          lines.push(`― (A): ${parsed.A}`);
          lines.push(`― (B): ${parsed.B}`);
          lines.push(`― (C): ${parsed.C}`);
        } else lines.push(`― Paragraph(raw):\n${paragraph}`);
        lines.push(`― 원문:\n${original ?? '(없음)'}`);
        return lines.join('\n');
      };

      if (!parsed || !original) {
        uncheckable.push(block('[파싱/원문없음]', !parsed ? '사유: (A)(B)(C) 라벨 분리 실패' : '사유: 원문 없음'));
        continue;
      }
      const hit = verifyOrderByAssembly(parsed, original);
      if (!hit) {
        uncheckable.push(block('[비연속-조립불가]', '사유: 어떤 순열도 원문과 일치하지 않음(청크가 원문에서 비연속 → 원문대조 불가)'));
        continue;
      }
      if (hit.isIdentity) {
        unshuffled.push(block('[셔플안함]', '사유: 원문 순서가 (A)-(B)-(C) = 셔플 안 된 불량 문항'));
        continue;
      }
      const computed = correctAnswerFromOwnOptions(qd.Options, hit.perm) || '?';
      if (computed === ca) { okCount += 1; continue; }
      mismatches.push(block('■■ 정답 불일치 ■■', `원문 읽기순서=${hit.perm} → 정답=${computed}  (저장=${ca})`));
    }
    console.log(`\n########## 순서: 총 ${orderDocs.length} / ✅조립검증 일치 ${okCount} / ■불일치 ${mismatches.length} / 셔플안함 ${unshuffled.length} / 원문대조불가 ${uncheckable.length} ##########`);
    if (mismatches.length) { console.log('\n===== ■ 정답 불일치 ====='); console.log(mismatches.join('\n')); }
    if (unshuffled.length) { console.log('\n===== 셔플 안 함 ====='); console.log(unshuffled.join('\n')); }
    if (uncheckable.length) { console.log('\n===== 원문대조 불가 (수기 확인 필요) ====='); console.log(uncheckable.join('\n')); }
  }

  // ── 삽입 ──
  if (wantInsert) {
    const CIRC = ['①', '②', '③', '④', '⑤'];
    const insDocs = docs.filter((d) => ['삽입', '삽입-고난도'].includes(String(d.type ?? '')));
    let okCount = 0;
    const mismatches: string[] = [];
    const uncheckable: string[] = [];
    for (const d of insDocs) {
      const qd = (d.question_data ?? {}) as Record<string, unknown>;
      const source = String(d.source ?? '');
      const ca = String(qd.CorrectAnswer ?? '').trim();
      const original = passageMap.get(String(d.passage_id));
      const paragraph = String(qd.Paragraph ?? '');
      // Paragraph = given 문장 + 빈줄 + 마커 passage
      const split = paragraph.split(/\n\s*\n/);
      const given = (split[0] ?? '').trim();
      const marked = split.slice(1).join('\n').trim() || paragraph;
      const parts = marked.split(/\(?\s*[①②③④⑤]\s*\)?/);

      const block = (tag: string, extra: string) => {
        const lines = [sep, `[삽입] ${source}   id=${String(d._id)}   저장정답=${ca || '(없음)'}  ${tag}`];
        if (extra) lines.push(extra);
        lines.push(`― 주어진 문장: ${given}`);
        lines.push(`― 마커 passage:\n${marked}`);
        lines.push(`― 원문:\n${original ?? '(없음)'}`);
        return lines.join('\n');
      };

      if (!original) { uncheckable.push(block('[원문없음]', '')); continue; }
      if (parts.length !== 6) { uncheckable.push(block('[마커≠5]', `사유: 마커 ${parts.length - 1}개`)); continue; }
      const o = norm(original);
      const g = norm(given);
      if (!g || !o.includes(g)) { uncheckable.push(block('[신규/패러프레이즈]', '사유: 주어진 문장이 원문에 그대로 없음 → 원문대조 불가(수기)')); continue; }
      const hits: number[] = [];
      for (let k = 1; k <= 5; k++) {
        const assembled = norm(`${parts.slice(0, k).join(' ')} ${given} ${parts.slice(k).join(' ')}`);
        if (assembled.length >= 20 && (o === assembled || o.startsWith(assembled) || o.includes(assembled))) hits.push(k);
      }
      if (hits.length === 0) { uncheckable.push(block('[위치불일치]', '사유: 어느 위치도 원문과 일치 안 함(표현 차이) → 수기')); continue; }
      if (hits.length > 1) { uncheckable.push(block('[복수일치]', `사유: 위치 ${hits.map((k) => CIRC[k - 1]).join(',')} 모두 일치(반복 표현) → 수기`)); continue; }
      const correct = CIRC[hits[0] - 1];
      if (correct === ca) { okCount += 1; continue; }
      mismatches.push(block('■■ 정답 불일치 ■■', `원문 기준 정답=${correct}  (저장=${ca})`));
    }
    console.log(`\n########## 삽입: 총 ${insDocs.length} / ✅원문대조 일치 ${okCount} / ■불일치 ${mismatches.length} / 원문대조불가 ${uncheckable.length} ##########`);
    if (mismatches.length) { console.log('\n===== ■ 정답 불일치 ====='); console.log(mismatches.join('\n')); }
    if (uncheckable.length) { console.log(`\n===== 원문대조 불가 ${uncheckable.length}건 (신규문장/패러프레이즈 — 수기) =====`); console.log(uncheckable.join('\n')); }
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
