import { loadCliEnv } from './_cli-env';
loadCliEnv(process.cwd());
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { fetchOrderQuestions, resolveOrderQuestionScope } from '@/lib/order-answer-sequence';

/**
 * 어법 문항 숨은 결함 점검 (read-only) — 자동검수(per-question)·cc:audit 가 못 잡는 것.
 *  - 정답이 아닌 밑줄 칸은 원문과 글자 그대로여야 한다(옳은 칸에 비문이 들어가면 실제 오답이 늘어난다).
 *  - 밑줄 밖 본문도 원문 그대로여야 한다.
 *  - 정답 칸은 원문과 달라야 한다(원문 그대로면 틀린 곳이 아니다).
 *  - 어법-고난도는 정답 2~3개, 기본 어법은 1개.
 * 밑줄을 걷어 낸 본문과 원문을 단어 단위로 정렬(LCS)해, 어긋난 구간이 어느 칸에 속하는지 본다.
 *
 *   npx tsx scripts/audit-order-grammar-underlines.ts <주문번호…> [--type 어법-고난도]
 */

type Doc = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const CIRCLED = '①②③④⑤';
const TOKEN = /[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)*|[^\sA-Za-z0-9]/g;

function norm(s: string): string {
  return s
    .replace(/[‘’′]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/ /g, ' ')
    .replace(/[①②③④⑤]/g, ' ');
}

interface Token {
  t: string;
  /** -1 = 밑줄 밖, k = k번째 밑줄(0-based) */
  seg: number;
}

function paragraphTokens(par: string): { tokens: Token[]; segments: number } {
  const tokens: Token[] = [];
  const re = /<u>([\s\S]*?)<\/u>/g;
  const push = (s: string, seg: number) => {
    for (const t of norm(s.replace(/<[^>]+>/g, '')).match(TOKEN) ?? []) tokens.push({ t, seg });
  };
  let last = 0;
  let k = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(par))) {
    push(par.slice(last, m.index), -1);
    push(m[1], k);
    k += 1;
    last = m.index + m[0].length;
  }
  push(par.slice(last), -1);
  return { tokens, segments: k };
}

/** LCS 로 정렬해 어긋난 구간마다 관련 칸(seg)을 모은다. 원문 쪽만 빠진 구간은 앞(없으면 뒤) 칸으로 돌린다. */
function diffSegments(a: Token[], b: string[]): { segs: Set<number>; spans: string[] } {
  const n = a.length;
  const m = b.length;
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i].t === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const segs = new Set<number>();
  const spans: string[] = [];
  let i = 0;
  let j = 0;
  let gapA: number[] = [];
  let gapB: string[] = [];
  const flush = () => {
    if (!gapA.length && !gapB.length) return;
    const involved = new Set<number>();
    if (gapA.length) {
      for (const x of gapA) involved.add(a[x].seg);
    } else {
      const prev = a[i - 1]?.seg;
      const next = a[i]?.seg;
      if (prev !== undefined && prev >= 0) involved.add(prev);
      else if (next !== undefined && next >= 0) involved.add(next);
      else involved.add(-1);
    }
    for (const s of involved) segs.add(s);
    const where = [...involved].map((s) => (s < 0 ? '밖' : CIRCLED[s] ?? `#${s + 1}`)).join(',');
    spans.push(`[${where}] "${gapA.map((x) => a[x].t).join(' ')}" ← 원문 "${gapB.join(' ')}"`);
    gapA = [];
    gapB = [];
  };
  while (i < n && j < m) {
    if (a[i].t === b[j]) {
      flush();
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      gapA.push(i);
      i += 1;
    } else {
      gapB.push(b[j]);
      j += 1;
    }
  }
  while (i < n) gapA.push(i++);
  while (j < m) gapB.push(b[j++]);
  flush();
  return { segs, spans };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const typeArg = args.includes('--type') ? args[args.indexOf('--type') + 1] : undefined;
  const orders = args.filter((a) => /^[A-Z]{2}-\d{8}-\d{3,}$/.test(a));
  if (!orders.length) {
    console.log('사용법: npx tsx scripts/audit-order-grammar-underlines.ts <주문번호…> [--type 어법-고난도]');
    process.exit(1);
  }
  const db = await getDb('gomijoshua');
  let total = 0;
  let bad = 0;
  for (const on of orders) {
    const order = (await db.collection('orders').findOne({ orderNumber: on })) as Doc | null;
    if (!order) {
      console.log(`${on}: 주문 없음`);
      continue;
    }
    const scope = resolveOrderQuestionScope(order);
    const types = typeArg ? [typeArg] : scope.types.filter((t) => /^어법/.test(t));
    for (const target of scope.targets) {
      for (const type of types) {
        const rows = await fetchOrderQuestions(db, target, type);
        const ids = [...new Set(rows.map((r) => str(r.doc.passage_id)))].filter((s) => /^[0-9a-f]{24}$/i.test(s));
        const ps = await db
          .collection('passages')
          .find({ _id: { $in: ids.map((s) => new ObjectId(s)) } })
          .project({ 'content.original': 1 })
          .toArray();
        const originals = new Map(ps.map((p) => [String(p._id), str(((p.content ?? {}) as Doc).original)]));
        const [minAnswers, maxAnswers] = /고난도/.test(type) ? [2, 3] : [1, 1];
        console.log(`\n═══ ${on} | ${target.textbook} | ${type} ${rows.length}문항`);
        for (const r of rows) {
          total += 1;
          const answers = new Set([...r.answer].map((c) => CIRCLED.indexOf(c)).filter((x) => x >= 0));
          const { tokens, segments } = paragraphTokens(str(r.qd.Paragraph));
          const originalTokens = norm(originals.get(str(r.doc.passage_id)) ?? '').match(TOKEN) ?? [];
          const { segs, spans } = diffSegments(tokens, originalTokens);
          const problems: string[] = [];
          if (segments !== 5) problems.push(`밑줄 ${segments}개`);
          if (answers.size < minAnswers || answers.size > maxAnswers) problems.push(`정답 ${answers.size}개`);
          for (const s of segs) {
            if (s < 0) problems.push('밑줄 밖 본문 변경');
            else if (!answers.has(s)) problems.push(`비정답 ${CIRCLED[s]} 칸이 원문과 다름`);
          }
          for (const s of answers) if (!segs.has(s)) problems.push(`정답 ${CIRCLED[s]} 칸이 원문 그대로`);
          if (!problems.length) continue;
          bad += 1;
          console.log(`  ✗ ${r.source} (정답 ${r.answer}) — ${[...new Set(problems)].join(' / ')}`);
          for (const sp of spans) console.log(`      ${sp}`);
        }
      }
    }
  }
  console.log(`\n점검 ${total}문항 · 결함 의심 ${bad}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
