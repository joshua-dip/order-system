/**
 * Claude Code 전용: 변형문제 save-item 배열을 DB 저장 전에 deterministic 검증.
 *
 * 메모리(feedback_variant_bulk_gen_pitfalls)의 두 실패 모드를 차단:
 *   1) 순서 ABC(미셔플) / ORDER_MAP 불일치  → order-answer-verify 라우트 로직 재현
 *   2) 에이전트가 Paragraph 를 truncate(…) 하거나 P1/S0/(A)= 식 표기로 대체
 * + 유형별 구조 검사(마커 수, <u> 수, 보기 5개, CorrectAnswer ①~⑤ 등).
 *
 * 사용:
 *   npx tsx scripts/cc-variant-validate.ts --json path/to/items.json
 *   cat items.json | npx tsx scripts/cc-variant-validate.ts --json -
 * 출력: { ok, total, passed, failed:[{index, source, type, reasons[]}], passIndexes[] }
 * 종료코드: 실패 1건 이상이면 2, 전부 통과면 0.
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

const CIRCLED = ['①', '②', '③', '④', '⑤'] as const;
const ORDER_MAP: Record<string, string> = {
  ACB: '①', BAC: '②', BCA: '③', CAB: '④', CBA: '⑤',
};

function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}
/** order-answer-verify 라우트와 동일한 위치 탐색 */
function findPosition(original: string, segment: string): number {
  const normOrig = normalize(original);
  for (const len of [80, 50, 30, 20]) {
    const needle = normalize(segment).slice(0, len);
    if (needle.length < 10) continue;
    const idx = normOrig.indexOf(needle);
    if (idx >= 0) return idx;
  }
  const words = normalize(segment).split(' ').slice(0, 4).join(' ');
  if (words.length >= 8) {
    const idx = normOrig.indexOf(words);
    if (idx >= 0) return idx;
  }
  return -1;
}
function parseOrderParagraph(raw: string) {
  const re1 = /^([\s\S]+?)\n###\n\(A\)\s*([\s\S]+?)\n###\n\(B\)\s*([\s\S]+?)\n###\n\(C\)\s*([\s\S]+)$/;
  const m1 = raw.match(re1);
  if (m1) return { intro: m1[1].trim(), A: m1[2].trim(), B: m1[3].trim(), C: m1[4].trim() };
  const re2 = /^([\s\S]+?)\n\n\(A\)\s*([\s\S]+?)\n\n\(B\)\s*([\s\S]+?)\n\n\(C\)\s*([\s\S]+)$/;
  const m2 = raw.match(re2);
  if (m2) return { intro: m2[1].trim(), A: m2[2].trim(), B: m2[3].trim(), C: m2[4].trim() };
  return null;
}

/** Paragraph 에서 마커·태그·밑줄 제거 → 순수 영문 텍스트 길이 비교용 */
function stripForLength(s: string): string {
  return s
    .replace(/<\/?u>/g, '')
    .replace(/[①②③④⑤]/g, '')
    .replace(/\(A\)|\(B\)|\(C\)/g, '')
    .replace(/_+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// 에이전트가 흔히 흘리는 placeholder/축약/표기 패턴
const PLACEHOLDER_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\.\.\.|…/, label: 'truncation ellipsis (…)' },
  { re: /\bP[1-3]\b/, label: 'P1/P2/P3 notation' },
  { re: /\bS\d\b/, label: 'S0/S1 sentence notation' },
  { re: /\([ABC]\)\s*=/, label: '(A)= mapping notation' },
  { re: /배치|문장\s*\d+\s*\+/, label: 'Korean placeholder/배치 notation' },
  { re: /\[(?:문장|sentence|insert|원문|passage)[^\]]*\]/i, label: 'bracketed placeholder' },
  { re: /<(?!\/?u>)[^>]+>/, label: 'non-<u> HTML/markup' },
];

interface Item {
  passage_id?: string;
  source?: string;
  type?: string;
  question_data?: Record<string, unknown>;
}

function checkItem(it: Item, original: string | null): string[] {
  const reasons: string[] = [];
  const type = String(it.type ?? '').trim();
  const qd = it.question_data;
  if (!qd || typeof qd !== 'object') return ['question_data 누락'];

  const Q = String((qd as any).Question ?? '').trim();
  const P = String((qd as any).Paragraph ?? '');
  const Opt = String((qd as any).Options ?? '');
  const CA = String((qd as any).CorrectAnswer ?? '').trim();
  const Exp = String((qd as any).Explanation ?? '').trim();
  const Cat = String((qd as any).Category ?? '').trim();

  if (!Q) reasons.push('Question 비어 있음');
  if (!P.trim()) reasons.push('Paragraph 비어 있음');
  if (!Exp) reasons.push('Explanation 비어 있음');
  if (Cat && Cat !== type) reasons.push(`Category(${Cat}) != type(${type})`);

  // 어법/삽입은 save 레이어가 Options 를 덮으므로 CorrectAnswer 만 확인
  const FIRST = CA.charAt(0);
  if (!CIRCLED.includes(FIRST as any)) reasons.push(`CorrectAnswer 가 ①~⑤ 아님: "${CA}"`);

  // placeholder / truncation
  for (const { re, label } of PLACEHOLDER_PATTERNS) {
    if (label === 'non-<u> HTML/markup') {
      // 원문에 실제로 들어 있는 < > (예: <Hop-on Hop-off City Tour>) 는 콘텐츠이므로 제외
      const matches = P.match(/<(?!\/?u>)[^>]+>/g) || [];
      const bad = matches.filter((m) => !original || !original.includes(m));
      if (bad.length) reasons.push(`Paragraph placeholder/축약 의심: ${label} (${bad[0]})`);
    } else if (re.test(P)) {
      reasons.push(`Paragraph placeholder/축약 의심: ${label}`);
    }
  }

  // 길이 비율 (truncation 차단). 삽입=원문+주어진문장, 요약=원문+요약문 → 상한 완화
  if (original) {
    const baseLen = stripForLength(original).length;
    const gotLen = stripForLength(P).length;
    if (baseLen > 0) {
      const ratio = gotLen / baseLen;
      // 무관한문장은 원문 일부만 쓰고 한 문장을 외부 문장으로 교체 → 길이 하한 완화.
      // (truncation 의 주 신호는 length 가 아니라 placeholder/ellipsis 검사.)
      const isInsert = type === '삽입' || type === '삽입-고난도';
      const isSummary = type === '요약' || type === '요약-고난도';
      const isIrrelevant = type === '무관한문장' || type === '무관한문장-고난도';
      const lo = isIrrelevant ? 0.4 : isInsert ? 0.75 : isSummary ? 0.95 : 0.85;
      const hi = isSummary ? 1.6 : isInsert ? 1.5 : isIrrelevant ? 1.3 : 1.2;
      if (ratio < lo) reasons.push(`Paragraph 길이 부족(원문 대비 ${(ratio * 100) | 0}%) — truncation 의심`);
      if (ratio > hi) reasons.push(`Paragraph 길이 과다(원문 대비 ${(ratio * 100) | 0}%)`);
    }
  }

  const uCount = (P.match(/<u>/g) || []).length;
  const uCloseCount = (P.match(/<\/u>/g) || []).length;
  const markerCount = CIRCLED.filter((c) => P.includes(c)).length;
  const optCount = CIRCLED.filter((c) => Opt.includes(c)).length;

  // 보기 중복 검사(서버 검증이 잡는 항목): ①~⑤ 텍스트가 서로 달라야 함. 어법/삽입은 save 가 보기를 덮으므로 제외.
  if (type !== '어법' && type !== '삽입' && type !== '삽입-고난도') {
    const parts = Opt.split(/\s*###\s*|\n/).map((s) => s.replace(/^[①②③④⑤]\s*/, '').trim()).filter((s) => s.length > 0);
    const seen = new Set<string>();
    for (const p of parts) {
      const k = p.toLowerCase().replace(/\s+/g, ' ');
      if (seen.has(k)) { reasons.push(`보기 중복: "${p.slice(0, 40)}"`); break; }
      seen.add(k);
    }
  }

  switch (type) {
    case '주제':
    case '주제-고난도':
    case '제목':
    case '제목-고난도':
    case '주장':
    case '주장-고난도':
    case '일치':
    case '일치-고난도':
    case '불일치':
    case '불일치-고난도': {
      if (optCount < 5) reasons.push(`Options 보기 ${optCount}/5`);
      if (markerCount > 0 || uCount > 0) reasons.push('본문에 불필요한 ①~⑤/<u> 마커');
      break;
    }
    case '함의':
    case '함의-고난도': {
      if (uCount !== 1 || uCloseCount !== 1) reasons.push(`<u> 정확히 1개여야 함 (열${uCount}/닫${uCloseCount})`);
      if (optCount < 5) reasons.push(`Options 보기 ${optCount}/5`);
      // 밑줄 구절이 원문에 존재?
      if (original && uCount === 1) {
        const m = P.match(/<u>([\s\S]*?)<\/u>/);
        const phrase = m ? m[1].trim() : '';
        if (phrase && !normalize(original).includes(normalize(phrase).slice(0, 40))) {
          reasons.push('밑줄 구절이 원문에 없음');
        }
      }
      break;
    }
    case '어법': {
      if (markerCount !== 5) reasons.push(`①~⑤ 마커 ${markerCount}/5`);
      if (uCount !== 5 || uCloseCount !== 5) reasons.push(`<u> 5쌍 필요 (열${uCount}/닫${uCloseCount})`);
      // 읽는 순서: ①②③④⑤ 가 본문 등장 순서와 일치
      const order = (P.match(/[①②③④⑤]/g) || []).join('');
      if (order !== '①②③④⑤') reasons.push(`밑줄 번호 순서 오류: ${order}`);
      // ③<u> 처럼 공백 없이 붙은 경우
      if (/[①②③④⑤]<u>/.test(P)) reasons.push('동그라미와 <u> 사이 공백 누락');
      break;
    }
    case '어휘': {
      // 표준 구조: 본문에 인라인 ①word 마커 5곳(①→⑤ 순, <u> 태그 없음), Options 는 밑줄 단어 5개 배열.
      // 정답은 문맥상 쓰임이 부적절한 낱말 1곳(①~⑤ 단일, 위 FIRST 검사로 확인). (cf. reference_variant_eohwi_vocab_structure)
      if (markerCount !== 5) reasons.push(`①~⑤ 인라인 마커 ${markerCount}/5`);
      const order = (P.match(/[①②③④⑤]/g) || []).join('');
      if (order !== '①②③④⑤') reasons.push(`마커 순서 오류: ${order}`);
      if (uCount > 0) reasons.push('어휘 본문에 <u> 태그가 있음 — 인라인 ①word 형식이어야 함');
      const eohwiOpts = (qd as { Options?: unknown }).Options;
      if (!Array.isArray(eohwiOpts) || eohwiOpts.length !== 5) {
        reasons.push(`Options 는 밑줄 단어 5개 배열이어야 함 (받음: ${Array.isArray(eohwiOpts) ? `${eohwiOpts.length}개 배열` : typeof eohwiOpts})`);
      }
      break;
    }
    case '어법-고난도': {
      // 어법과 동일한 구조 검사 + CorrectAnswer 는 ①~⑤ 중 2~5개 연속(모두 고르기).
      if (markerCount !== 5) reasons.push(`①~⑤ 마커 ${markerCount}/5`);
      if (uCount !== 5 || uCloseCount !== 5) reasons.push(`<u> 5쌍 필요 (열${uCount}/닫${uCloseCount})`);
      const order = (P.match(/[①②③④⑤]/g) || []).join('');
      if (order !== '①②③④⑤') reasons.push(`밑줄 번호 순서 오류: ${order}`);
      if (/[①②③④⑤]<u>/.test(P)) reasons.push('동그라미와 <u> 사이 공백 누락');
      // CorrectAnswer: 동그라미 2~5개만, 중복·기타문자 없이 ①→⑤ 순.
      if (!/^[①②③④⑤]{2,5}$/.test(CA)) reasons.push(`어법-고난도 CorrectAnswer 는 ①~⑤ 2~5개 연속이어야 함: "${CA}"`);
      else {
        const sorted = CIRCLED.filter((c) => CA.includes(c)).join('');
        if (sorted !== CA) reasons.push(`CorrectAnswer 정렬/중복 오류(①→⑤ 순, 중복 금지): "${CA}"`);
      }
      break;
    }
    case '삽입-고난도': {
      // Paragraph = 새로 생성한 문장 \n###\n(또는 \n\n) 본문(①~⑤). 주어진 문장은 원문에 없어야(originality).
      const parts = P.split(/\n###\n|\n\n+/);
      if (parts.length < 2) { reasons.push('삽입-고난도 형식: 생성 문장 + 구분(\\n###\\n) + 본문 필요'); break; }
      const given = parts[0].trim();
      const body = parts.slice(1).join(' ');
      const bodyMarkers = (body.match(/[①②③④⑤]/g) || []);
      if (bodyMarkers.length !== 5) reasons.push(`본문 삽입 위치 마커 ${bodyMarkers.length}/5`);
      const givenWords = given.split(/\s+/).filter(Boolean).length;
      if (givenWords < 12 || givenWords > 38) reasons.push(`생성 문장 길이 ${givenWords}단어 (15~35 권장)`);
      // 지시어/연결어 필수 (이전 문장에 anchor)
      if (!/\b(this|these|those|such|that|however|therefore|consequently|as a result|in other words|thus|moreover|furthermore|nevertheless|for this reason|hence)\b/i.test(given))
        reasons.push('생성 문장에 지시어/연결어(this·such·however 등) 없음');
      // 정답은 ②③④⑤ (① 금지)
      if (FIRST === '①') reasons.push('삽입-고난도 정답이 ① (②③④⑤ 중이어야 함)');
      // originality: 생성 문장이 원문에 그대로 있으면 안 됨(중난도 추출형과 구분)
      if (original && normalize(original).includes(normalize(given).slice(0, 40))) reasons.push('생성 문장이 원문에 이미 존재(고난도는 새 문장이어야)');
      break;
    }
    case '순서':
    case '순서-고난도': {
      const parsed = parseOrderParagraph(P);
      if (!parsed) { reasons.push('순서 Paragraph 형식 불일치 (intro\\n\\n(A) ..\\n\\n(B) ..\\n\\n(C) ..)'); break; }
      if (!original) { reasons.push('원문 없음 — 순서 검증 불가'); break; }
      const pos = { A: findPosition(original, parsed.A), B: findPosition(original, parsed.B), C: findPosition(original, parsed.C) };
      if (pos.A < 0 || pos.B < 0 || pos.C < 0) { reasons.push(`(A)(B)(C) 블록을 원문에서 못 찾음 ${JSON.stringify(pos)}`); break; }
      const key = (['A', 'B', 'C'] as const).map((k) => ({ k, p: pos[k] })).sort((a, b) => a.p - b.p).map((x) => x.k).join('');
      if (key === 'ABC') { reasons.push('순서 미셔플(ABC) — 보기에 없는 정답'); break; }
      const expected = ORDER_MAP[key];
      if (!expected) reasons.push(`읽기순서 ${key} 매핑 불가`);
      else if (expected !== FIRST) reasons.push(`CorrectAnswer ${CA} != ORDER_MAP[${key}]=${expected}`);
      if (optCount < 5) reasons.push(`Options 보기 ${optCount}/5`);
      // 학생 일관성: Options 는 ORDER_MAP 정합 표준이어야 함 (보기 N = ORDER_MAP 으로 N 에 매핑되는 배열).
      // 구분자는 `###` 또는 개행 모두 허용 — 학생 practice page 는 split('###') 만 하므로 `###` 가 렌더 정답이지만,
      // 키 검증 관점에선 둘 다 동일. (cf. feedback_variant_order_options_validator_bug)
      const optNorm = Opt.replace(/\s+/g, '').replace(/###/g, '');
      if (optNorm !== '①(A)-(C)-(B)②(B)-(A)-(C)③(B)-(C)-(A)④(C)-(A)-(B)⑤(C)-(B)-(A)') {
        reasons.push('순서 Options 가 표준(ORDER_MAP 정합) 형식이 아님 — cc-variant-fix-order 로 통일 필요');
      }
      break;
    }
    case '삽입': {
      // Paragraph = 주어진 문장 \n\n 본문(①~⑤)
      const parts = P.split(/\n\n+/);
      if (parts.length < 2) { reasons.push('삽입 형식: 주어진 문장 + 빈 줄 + 본문 필요'); break; }
      const given = parts[0].trim();
      const body = parts.slice(1).join('\n\n');
      const bodyMarkers = (body.match(/[①②③④⑤]/g) || []);
      if (bodyMarkers.length !== 5) reasons.push(`본문 삽입 위치 마커 ${bodyMarkers.length}/5`);
      if (given.length < 10) reasons.push('주어진 문장이 너무 짧음');
      // 중난도: 주어진 문장은 원문에서 추출 → 원문에 존재해야 하고 본문에는 없어야
      if (original) {
        if (!normalize(original).includes(normalize(given).slice(0, 40))) reasons.push('주어진 문장이 원문에 없음(중난도 추출형)');
        if (normalize(body).includes(normalize(given).slice(0, 40))) reasons.push('주어진 문장이 본문에 그대로 남아 있음');
      }
      break;
    }
    case '빈칸':
    case '빈칸-고난도': {
      const blanks = (P.match(/<u>_+<\/u>|_{3,}/g) || []).length;
      if (blanks < 1) reasons.push('빈칸(<u>____</u>) 없음');
      if (blanks > 1) reasons.push(`빈칸이 ${blanks}개 (1개여야 함)`);
      if (optCount < 5) reasons.push(`Options 보기 ${optCount}/5`);
      break;
    }
    case '요약':
    case '요약-고난도': {
      const hasA = /\(A\)/.test(P);
      const hasB = /\(B\)/.test(P);
      if (!hasA || !hasB) reasons.push('요약문에 (A)/(B) 빈칸 누락');
      const hasArrow = /→/.test(P) || /\n\n/.test(P);
      if (!hasArrow) reasons.push('원문과 요약문 구분(빈 줄/→) 누락');
      if (optCount < 5) reasons.push(`Options 보기 ${optCount}/5`);
      if (/\(A\)/.test(Opt) === false || /\(B\)/.test(Opt) === false) reasons.push('Options 에 (A)/(B) 형식 누락');
      break;
    }
    case '무관한문장':
    case '무관한문장-고난도': {
      const nums = (P.match(/[①②③④⑤]/g) || []);
      if (nums.length !== 5) reasons.push(`①~⑤ 문장 번호 ${nums.length}/5`);
      const order = nums.join('');
      if (order !== '①②③④⑤') reasons.push(`문장 번호 순서 오류: ${order}`);
      break;
    }
    case '어휘-고난도': {
      // 본문에 인라인 `① <u>word</u>` 마커 5곳(①→⑤ 순), Options 는 밑줄 단어 5개 문자열(### 구분),
      // CorrectAnswer 는 문맥상 부적절한 낱말을 모두 고르기(①~⑤ 중 1~5개, ①→⑤ 순, 중복 금지).
      if (markerCount !== 5) reasons.push(`①~⑤ 마커 ${markerCount}/5`);
      const order = (P.match(/[①②③④⑤]/g) || []).join('');
      if (order !== '①②③④⑤') reasons.push(`마커 순서 오류: ${order}`);
      if (uCount !== 5 || uCloseCount !== 5) reasons.push(`<u> 5쌍 필요 (열${uCount}/닫${uCloseCount})`);
      if (optCount < 5) reasons.push(`Options 보기 ${optCount}/5`);
      if (!/^[①②③④⑤]{1,5}$/.test(CA)) reasons.push(`어휘-고난도 CorrectAnswer 는 ①~⑤ 1~5개 연속이어야 함: "${CA}"`);
      else {
        const sorted = CIRCLED.filter((c) => CA.includes(c)).join('');
        if (sorted !== CA) reasons.push(`CorrectAnswer 정렬/중복 오류(①→⑤ 순, 중복 금지): "${CA}"`);
      }
      break;
    }
    default:
      reasons.push(`알 수 없는 type: ${type}`);
  }
  return reasons;
}

async function main() {
  const argv = process.argv.slice(2);
  const jIdx = argv.indexOf('--json');
  const jsonPath = jIdx >= 0 ? argv[jIdx + 1] : '';
  if (!jsonPath) { console.error('--json <파일|-> 필요'); process.exit(1); }
  const raw = jsonPath === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(path.isAbsolute(jsonPath) ? jsonPath : path.join(process.cwd(), jsonPath), 'utf8');
  let body: unknown;
  try { body = JSON.parse(raw); } catch { console.error('JSON 파싱 실패'); process.exit(1); }
  const items: Item[] = Array.isArray(body) ? body : [body as Item];

  const ids = [...new Set(items.map((i) => String(i.passage_id ?? '')).filter((x) => ObjectId.isValid(x)))];
  const passageMap = new Map<string, string>();
  if (ids.length) {
    const db = await getDb('gomijoshua');
    const ps = await db.collection('passages').find({ _id: { $in: ids.map((i) => new ObjectId(i)) } }).project({ _id: 1, 'content.original': 1 }).toArray();
    for (const p of ps) {
      const orig = (p.content as any)?.original;
      if (typeof orig === 'string') passageMap.set(String(p._id), orig);
    }
  }

  const failed: { index: number; source: string; type: string; reasons: string[] }[] = [];
  const passIndexes: number[] = [];
  items.forEach((it, idx) => {
    const original = passageMap.get(String(it.passage_id ?? '')) ?? null;
    const reasons = checkItem(it, original);
    if (reasons.length) failed.push({ index: idx, source: String(it.source ?? ''), type: String(it.type ?? ''), reasons });
    else passIndexes.push(idx);
  });

  console.log(JSON.stringify({
    ok: failed.length === 0,
    total: items.length,
    passed: passIndexes.length,
    failedCount: failed.length,
    failed,
    passIndexes,
  }, null, 2));
  process.exit(failed.length ? 2 : 0);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
