/**
 * 글의의미 「단서 문장 찾아 직역」 변형 적합도 스크리너 (read-only, DB 변경 없음).
 *
 * 지문마다 "무엇을 물을지(양상/영향/원인/결과/근거/대조…)"가 다르고, 모든 지문이
 * 「양상·영향」 구조를 갖추지는 않는다. 이 도구는 영어 본문의 담화 표지를 문장 단위로
 * 탐지해 ① 이 변형에 적합한지 ② 적합하면 어떤 관계쌍 + 밑줄 후보인지 ③ 부적합하면
 * "기본 속뜻형 권장"으로 분류한다. (정답·해설 작성은 여전히 Pro 채팅에서 직접 — 도구는 triage·제안만.)
 *
 * 실행:
 *   npx tsx scripts/screen-meaning-variant-fit.ts --textbook "지금필수 고난도유형(2026)"
 *   npx tsx scripts/screen-meaning-variant-fit.ts --id 69d4eca372a886137cd83f0b
 *   추가 플래그: --only-fit (적합만)  --limit 50
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

function getFlag(name: string): string {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : '';
}
const hasFlag = (n: string) => process.argv.slice(2).includes(`--${n}`);

/** 영어 본문 → 문장 배열 (cc-essay-cli parseSentences 와 동일 규칙) */
function parseSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z"'(])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10);
}

/** 담화 표지 사전 — cat: [정규식, 라벨] */
const MARKERS: Record<string, Array<[RegExp, string]>> = {
  // 결과·영향 (인과 결과 표지 — 「영향」의 핵심)
  RESULT: [
    [/\b(consequently|therefore|thus|hence|accordingly)\b/i, '결과접속'],
    [/\bas a result\b/i, 'as a result'],
    [/\bin turn\b/i, 'in turn'],
    [/\bresult(?:s|ing)? in\b/i, 'result in'],
    [/\blead(?:s|ing)? to\b|\bled to\b/i, 'lead to'],
    [/\bgive(?:s)? rise to\b/i, 'give rise to'],
    [/\bbring(?:s|ing)? about\b/i, 'bring about'],
    [/\bso that\b/i, 'so that'],
    [/\b(?:may|can|could|might)\s+(?:limit|reduce|cause|hinder|prevent|lead|enable|allow|force|make)\b/i, '양태+결과동사'],
    [/\b(?:hindering|causing|limiting|enabling|forcing|preventing|reducing)\b/i, '결과 분사'],
  ],
  // 원인
  CAUSE: [
    [/\bbecause\b/i, 'because'],
    [/\bdue to\b/i, 'due to'],
    [/\bowing to\b/i, 'owing to'],
    [/\b(?:arises?|stems?|results?|comes?) from\b/i, '~에서 비롯'],
    [/\bcaused by\b/i, 'caused by'],
    [/\bthe reason(?:s)?\b/i, 'the reason'],
  ],
  // 지시 결속 (앞 내용을 받아 풀어줌 — 「양상/구체화」 단서). "such as"(예시)는 제외
  DEMO: [
    [/\bsuch\s+(?!as\b)[a-z]+/i, 'such + 명사'],
    [/^(?:this|these|those|that)\s+[a-z]+/i, '지시어 시작'],
  ],
  // 양상·구체화 (어떻게 일어나는지)
  ELAB: [
    [/^as\s+[a-z]/i, 'As ~(부사절)'],
    [/^when\s+[a-z]/i, 'When ~'],
    [/\bby\s+\w+ing\b/i, 'by -ing'],
    [/\bthrough\s+\w+ing\b/i, 'through -ing'],
    [/\bin that\b/i, 'in that'],
    [/\b(?:specifically|namely)\b/i, 'specifically'],
    [/\bin other words\b|\bthat is,/i, 'in other words'],
  ],
  // 예시 (근거/사례)
  EXAMPLE: [
    [/\bfor example\b|\bfor instance\b/i, 'for example'],
    [/\bsuch as\b/i, 'such as'],
    [/\be\.g\./i, 'e.g.'],
    [/\bto illustrate\b/i, 'to illustrate'],
    [/\bincluding\b/i, 'including'],
  ],
  // 대조
  CONTRAST: [
    [/\bhowever\b/i, 'however'],
    [/\b(?:in|by) contrast\b/i, 'in contrast'],
    [/\bon the other hand\b/i, 'on the other hand'],
    [/\bwhereas\b/i, 'whereas'],
    [/\bwhile\b/i, 'while'],
    [/\bunlike\b/i, 'unlike'],
    [/\bconversely\b|\bon the contrary\b/i, 'conversely'],
  ],
  // 정의
  DEFINITION: [
    [/\bis defined as\b|\bcan be defined\b/i, 'is defined as'],
    [/\brefers? to\b/i, 'refer to'],
    [/\bis known as\b/i, 'is known as'],
    [/\bmeans that\b/i, 'means that'],
    [/\bis a (?:way|type|form|process|kind|set) of\b/i, 'is a … of'],
  ],
  // 조건
  CONDITION: [
    [/^if\b/i, 'If ~'],
    [/\bunless\b/i, 'unless'],
    [/\bprovided that\b|\bas long as\b|\bin case\b/i, 'provided that'],
  ],
};

type SentTag = { idx: number; text: string; cats: Record<string, string[]> };

function detect(sentences: string[]): SentTag[] {
  return sentences.map((text, idx) => {
    const cats: Record<string, string[]> = {};
    for (const [cat, list] of Object.entries(MARKERS)) {
      for (const [re, label] of list) {
        if (re.test(text)) {
          (cats[cat] ??= []).push(label);
        }
      }
    }
    return { idx, text, cats };
  });
}

const has = (tags: SentTag[], cat: string) => tags.filter((t) => t.cats[cat]?.length);
/** 밑줄 후보(추정): 지시어 다음 명사, 없으면 첫 문장 주어부 */
function anchorHint(tags: SentTag[]): string {
  for (const t of tags) {
    const m = t.text.match(/\b(?:such|this|these|those)\s+((?:[a-z]+\s+){0,2}[a-z]+)/i);
    if (m && t.idx > 0) return `"${m[1].trim()}" 부근 (S${t.idx} 가 앞 문장을 지시결속)`;
  }
  const first = tags[0]?.text ?? '';
  const subj = first.split(/\s+/).slice(0, 6).join(' ');
  return `S0 주어부 "${subj}…" 등 초반 추상 명사구`;
}

/** 관계쌍 후보 산출 + 적합도 */
function classify(tags: SentTag[]) {
  const result = has(tags, 'RESULT');
  const cause = has(tags, 'CAUSE');
  const demo = has(tags, 'DEMO');
  const elab = has(tags, 'ELAB');
  const example = has(tags, 'EXAMPLE');
  const contrast = has(tags, 'CONTRAST');
  const def = has(tags, 'DEFINITION');
  const cond = has(tags, 'CONDITION');
  const manner = [...new Set([...demo, ...elab])]; // 양상 단서(지시결속·구체화)

  const pairs: { pair: string; conf: '강' | '중' | '약'; cue: string }[] = [];

  // 양상/영향 — 핵심 타깃. 양상 단서 + 결과(인과) 표지 둘 다, 서로 다른 문장.
  if (manner.length && result.length) {
    const mIdx = manner.map((t) => t.idx);
    const rIdx = result.map((t) => t.idx);
    const distinct = rIdx.some((r) => !mIdx.includes(r)) || mIdx.some((m) => !rIdx.includes(m));
    if (distinct) {
      const strongResult = result.some((t) => /결과접속|as a result|결과 분사|양태\+결과동사/.test((t.cats.RESULT ?? []).join()));
      pairs.push({
        pair: '양상/영향',
        conf: strongResult && demo.length ? '강' : '중',
        cue: `양상←S${mIdx.join(',')}(${[...new Set(manner.flatMap((t) => t.cats.DEMO ?? t.cats.ELAB ?? []))].join('·')}) / 영향←S${rIdx.join(',')}(${[...new Set(result.flatMap((t) => t.cats.RESULT ?? []))].join('·')})`,
      });
    }
  }
  // 원인/결과
  if (cause.length && result.length) {
    pairs.push({ pair: '원인/결과', conf: '중', cue: `원인←S${cause.map((t) => t.idx).join(',')} / 결과←S${result.map((t) => t.idx).join(',')}` });
  }
  // 주장/근거(사례)
  if (example.length) {
    pairs.push({ pair: '주장/근거(사례)', conf: example.length > 1 ? '중' : '약', cue: `사례←S${example.map((t) => t.idx).join(',')}(${[...new Set(example.flatMap((t) => t.cats.EXAMPLE ?? []))].join('·')})` });
  }
  // 정의/대조
  if (def.length && contrast.length) {
    pairs.push({ pair: '정의/대조', conf: '중', cue: `정의←S${def.map((t) => t.idx).join(',')} / 대조←S${contrast.map((t) => t.idx).join(',')}` });
  }
  // 조건/귀결
  if (cond.length && result.length) {
    pairs.push({ pair: '조건/귀결', conf: '약', cue: `조건←S${cond.map((t) => t.idx).join(',')} / 귀결←S${result.map((t) => t.idx).join(',')}` });
  }

  // "양상은 있으나 영향(인과) 없음" — 흔한 부적합 사유 진단
  const onlyManner = manner.length && !result.length && !cause.length;
  const order = { 강: 0, 중: 1, 약: 2 } as const;
  pairs.sort((a, b) => order[a.conf] - order[b.conf]);
  const best = pairs[0] ?? null;
  return { best, pairs, anchor: anchorHint(tags), onlyManner, manner: manner.length, result: result.length, contrast: contrast.length };
}

async function main() {
  const id = getFlag('id').trim();
  const textbook = getFlag('textbook').trim();
  const onlyFit = hasFlag('only-fit');
  const limit = Math.max(1, Math.min(500, Number(getFlag('limit') || '300')));
  if (!id && !textbook) {
    console.error('사용법: --textbook "교재명"  또는  --id <passageId>  [--only-fit] [--limit N]');
    process.exit(1);
  }
  const db = await getDb('gomijoshua');
  const query = id ? { _id: new ObjectId(id) } : { textbook };
  const docs = (await db
    .collection('passages')
    .find(query as Record<string, unknown>)
    .project({ source_key: 1, chapter: 1, number: 1, 'content.original': 1 })
    .sort({ chapter: 1, number: 1 })
    .limit(limit)
    .toArray()) as Array<{ _id: ObjectId; source_key?: string; content?: { original?: string } }>;

  const fit: string[] = [];
  const unfit: string[] = [];
  let strong = 0;
  const pairTally: Record<string, number> = {};

  for (const d of docs) {
    const original = String(d.content?.original ?? '');
    const sentences = parseSentences(original);
    const sk = String(d.source_key ?? '');
    if (sentences.length < 3) {
      unfit.push(`[✗ 부적합] ${sk}  id=${d._id}\n  사유: 문장 ${sentences.length}개(너무 짧음) → 기본 속뜻형 권장`);
      continue;
    }
    const c = classify(detect(sentences));
    if (c.best) {
      if (c.best.conf === '강') strong += 1;
      pairTally[c.best.pair] = (pairTally[c.best.pair] ?? 0) + 1;
      const star = c.best.conf === '강' ? '★★' : c.best.conf === '중' ? '★' : '·';
      const others = c.pairs.slice(1).map((p) => `${p.pair}(${p.conf})`).join(', ');
      fit.push(
        `[${star} 적합] ${sk}  id=${d._id}\n` +
          `  추천 관계쌍: ${c.best.pair} (${c.best.conf})\n` +
          `  단서: ${c.best.cue}\n` +
          `  밑줄 후보(추정): ${c.anchor}` +
          (others ? `\n  대안 관계쌍: ${others}` : ''),
      );
    } else {
      const why = c.onlyManner
        ? '지시결속·구체화(양상)는 있으나 인과·결과 표지가 없어 「영향」 문항이 안 나옴'
        : c.contrast
        ? '대조 표지뿐 — 정의/대조로도 약함'
        : '인과·지시·예시·정의·조건 표지가 약함(단순 나열/서술)';
      unfit.push(`[✗ 부적합] ${sk}  id=${d._id}\n  사유: ${why} → 기본 속뜻형 권장`);
    }
  }

  console.log(`\n########## 글의의미 변형 적합도 스크리너 ##########`);
  console.log(`대상: ${id ? `passage ${id}` : `교재 "${textbook}"`} · 지문 ${docs.length}건`);
  console.log(`적합 ${fit.length}건 (강 ${strong}) / 부적합 ${unfit.length}건`);
  console.log(`적합 관계쌍 분포: ${Object.entries(pairTally).map(([k, v]) => `${k} ${v}`).join(' · ') || '없음'}`);
  console.log(`\n===== 적합 (단서 문장 찾기 변형 가능) =====`);
  console.log(fit.join('\n──\n') || '(없음)');
  if (!onlyFit) {
    console.log(`\n===== 부적합 (기본 속뜻형 권장) =====`);
    console.log(unfit.join('\n') || '(없음)');
  }
  console.log(`\n※ 휴리스틱(표지 기반) 1차 triage 입니다. 표지가 있어도 양상/영향 문장이 별개로 깔끔한지는 사람이 최종 확인하세요.`);
  process.exit(0);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
