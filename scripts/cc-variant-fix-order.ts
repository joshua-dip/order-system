/**
 * 순서 계열(순서 · 순서-고난도) 결정론적 교정기.
 * - Paragraph 의 (A)(B)(C) 블록을 원문(content.original)에서 위치 탐색 → 읽기 순서 계산
 * - CorrectAnswer = ORDER_MAP[읽기순서], Options = ORDER_MAP 정합 표준 보기로 통일
 *   (order-answer-verify 라우트 + 학생 표시 모두 일관)
 *
 * 사용:
 *   npx tsx scripts/cc-variant-fix-order.ts --json file.json            # 파일 in-place 수정
 *   npx tsx scripts/cc-variant-fix-order.ts --db --textbook "교재명"     # DB generated_questions 직접 수정
 * 출력: { fixed, unfixable:[{source, reason}] }
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

const ORDER_MAP: Record<string, string> = { ACB: '①', BAC: '②', BCA: '③', CAB: '④', CBA: '⑤' };
/** 순서 계열 유형 — 검증기(cc-variant-validate)가 ORDER_MAP 정합을 똑같이 검사하므로 함께 교정한다. */
const ORDER_TYPES = ['순서', '순서-고난도'];
// ORDER_MAP 정합 표준 보기: 위치 N 의 배열문자열이 ORDER_MAP 으로 N 에 매핑되는 순서
const CANON_OPTIONS = '① (A) - (C) - (B)\n② (B) - (A) - (C)\n③ (B) - (C) - (A)\n④ (C) - (A) - (B)\n⑤ (C) - (B) - (A)';

function normalize(s: string): string { return s.replace(/\s+/g, ' ').trim().toLowerCase(); }
function findPosition(original: string, segment: string): number {
  const normOrig = normalize(original);
  for (const len of [80, 50, 30, 20]) {
    const needle = normalize(segment).slice(0, len);
    if (needle.length < 10) continue;
    const idx = normOrig.indexOf(needle); if (idx >= 0) return idx;
  }
  const words = normalize(segment).split(' ').slice(0, 4).join(' ');
  if (words.length >= 8) { const idx = normOrig.indexOf(words); if (idx >= 0) return idx; }
  return -1;
}
function parseParagraph(raw: string) {
  const re1 = /^([\s\S]+?)\n###\n\(A\)\s*([\s\S]+?)\n###\n\(B\)\s*([\s\S]+?)\n###\n\(C\)\s*([\s\S]+)$/;
  const m1 = raw.match(re1); if (m1) return { A: m1[2].trim(), B: m1[3].trim(), C: m1[4].trim() };
  const re2 = /^([\s\S]+?)\n\n\(A\)\s*([\s\S]+?)\n\n\(B\)\s*([\s\S]+?)\n\n\(C\)\s*([\s\S]+)$/;
  const m2 = raw.match(re2); if (m2) return { A: m2[2].trim(), B: m2[3].trim(), C: m2[4].trim() };
  return null;
}
/** 한 순서 question_data 를 교정. 성공 시 true, 실패 사유 시 string */
function fixOrderQd(qd: Record<string, unknown>, original: string): true | string {
  const P = String(qd.Paragraph ?? '');
  const parsed = parseParagraph(P);
  if (!parsed) return 'Paragraph 형식 불일치';
  const pos = { A: findPosition(original, parsed.A), B: findPosition(original, parsed.B), C: findPosition(original, parsed.C) };
  if (pos.A < 0 || pos.B < 0 || pos.C < 0) return `블록 위치 못 찾음 ${JSON.stringify(pos)}`;
  const key = (['A', 'B', 'C'] as const).map((k) => ({ k, p: pos[k] })).sort((a, b) => a.p - b.p).map((x) => x.k).join('');
  if (key === 'ABC') return '미셔플(ABC) — 재생성 필요';
  const ca = ORDER_MAP[key]; if (!ca) return `매핑 불가 ${key}`;
  qd.CorrectAnswer = ca;
  qd.Options = CANON_OPTIONS;
  return true;
}

async function main() {
  const argv = process.argv.slice(2);
  const isDb = argv.includes('--db');
  const db = await getDb('gomijoshua');

  if (isDb) {
    const tIdx = argv.indexOf('--textbook');
    const textbook = tIdx >= 0 ? argv[tIdx + 1] : '';
    if (!textbook) { console.error('--textbook 필요'); process.exit(1); }
    const col = db.collection('generated_questions');
    const docs = await col.find({ textbook, type: { $in: ORDER_TYPES } }).toArray();
    const pIds = [...new Set(docs.map((d) => String(d.passage_id)))];
    const pmap = new Map<string, string>();
    const ps = await db.collection('passages').find({ _id: { $in: pIds.map((i) => new ObjectId(i)) } }).project({ _id: 1, 'content.original': 1 }).toArray();
    for (const p of ps) { const o = (p.content as any)?.original; if (typeof o === 'string') pmap.set(String(p._id), o); }
    let fixed = 0; const unfixable: any[] = [];
    for (const d of docs) {
      const original = pmap.get(String(d.passage_id));
      if (!original) { unfixable.push({ id: String(d._id), reason: '원문 없음' }); continue; }
      const qd = { ...(d.question_data as Record<string, unknown>) };
      const r = fixOrderQd(qd, original);
      if (r === true) { await col.updateOne({ _id: d._id }, { $set: { question_data: qd, updated_at: new Date() } }); fixed++; }
      else unfixable.push({ id: String(d._id), source: d.source, reason: r });
    }
    console.log(JSON.stringify({ mode: 'db', textbook, totalOrder: docs.length, fixed, unfixable }, null, 2));
    process.exit(0);
  }

  const jIdx = argv.indexOf('--json');
  const jsonPath = jIdx >= 0 ? argv[jIdx + 1] : '';
  if (!jsonPath) { console.error('--json 또는 --db 필요'); process.exit(1); }
  const abs = path.isAbsolute(jsonPath) ? jsonPath : path.join(process.cwd(), jsonPath);
  const items: any[] = JSON.parse(fs.readFileSync(abs, 'utf8'));
  const orderItems = items.filter((it) => ORDER_TYPES.includes(it.type));
  const pIds = [...new Set(orderItems.map((it) => String(it.passage_id)).filter((x) => ObjectId.isValid(x)))];
  const pmap = new Map<string, string>();
  const ps = await db.collection('passages').find({ _id: { $in: pIds.map((i) => new ObjectId(i)) } }).project({ _id: 1, 'content.original': 1 }).toArray();
  for (const p of ps) { const o = (p.content as any)?.original; if (typeof o === 'string') pmap.set(String(p._id), o); }
  let fixed = 0; const unfixable: any[] = [];
  for (const it of orderItems) {
    const original = pmap.get(String(it.passage_id));
    if (!original) { unfixable.push({ source: it.source, reason: '원문 없음' }); continue; }
    const r = fixOrderQd(it.question_data, original);
    if (r === true) fixed++; else unfixable.push({ source: it.source, reason: r });
  }
  fs.writeFileSync(abs, JSON.stringify(items, null, 2));
  console.log(JSON.stringify({ mode: 'file', file: abs, totalOrder: orderItems.length, fixed, unfixable }, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
