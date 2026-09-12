import { loadCliEnv } from './_cli-env';
loadCliEnv(process.cwd());
import { ObjectId, type Db } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { SHUFFLABLE_TYPES } from '@/lib/variant-save-generated-question';
import {
  ANY_TARGET,
  CIRCLED,
  NO_TARGET,
  balanceCapFor,
  describeInsertionMarkers,
  describeSequence,
  fetchOrderQuestions,
  insertionMarkerOptions,
  isSingleAnswerSequence,
  orderAnswerFromText,
  parseInsertionParagraph,
  planAnswerSequence,
  relabelOrderQuestion,
  resolveOrderQuestionScope,
  rewriteInsertionQuestion,
  swapShuffledAnswer,
  writeVariantBackup,
  writeVariantDraft,
  type InsertionLayout,
  type InsertionOption,
  type OrderQuestionRow,
  type OrderQuestionScope,
} from '@/lib/order-answer-sequence';

/**
 * 주문 정답열 점검·교정 — 인쇄 순서(출처 순)로 이웃한 문항의 정답이 연달아 같거나 xyxy 로 반복되지 않게.
 * 절차·주의: docs/variant/REVIEW.md §7. 기본은 dry-run, --apply 로 적용(백업은 .variant-drafts/backups/).
 *
 *   npm run cc:answer-seq -- check    <주문번호>                      # 유형별 정답열·분포·연속 반복 (read-only)
 *   npm run cc:answer-seq -- order    <주문번호> [--list] [--apply]     # 순서: (A)(B)(C) 라벨 치환
 *   npm run cc:answer-seq -- insert   <주문번호> [--lock "09회 25번,08회 38번"] [--relaxed] [--apply]
 *                                                                      # 삽입: 마커 자리 이동
 *   npm run cc:answer-seq -- shuffled <주문번호> [--types 빈칸-고난도,주제-고난도] [--cap 2] [--apply]
 *                                                                      # 셔플형: 정답 보기와 목표 보기 맞바꿈
 *
 * 교정은 검수 전(status 대기)에 한다 — 검수 뒤 고치면 검수 기록과 본문이 어긋난다.
 * 삽입은 적용 전에 dry-run 이 쓴 초안을 prevalidate 하고, 작성자가 일부러 비워 둔 자리가 있는 문항은 --lock 으로 고정한다.
 */

type Doc = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const CIRCLED_LIST: readonly string[] = CIRCLED;
const asStrings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

interface Ctx {
  db: Db;
  orderNumber: string;
  scope: OrderQuestionScope;
  apply: boolean;
  args: string[];
}

interface Update {
  id: ObjectId;
  source: string;
  type: string;
  set: Doc;
  before: Doc;
}

function listArg(args: string[], name: string): string[] {
  const i = args.indexOf(name);
  return i >= 0 ? String(args[i + 1] ?? '').split(',').map((s) => s.trim()).filter(Boolean) : [];
}

async function passageContent(db: Db, rows: OrderQuestionRow[], field: 'original' | 'sentences_en'): Promise<Map<string, unknown>> {
  const ids = [...new Set(rows.map((r) => str(r.doc.passage_id)))].filter((s) => /^[0-9a-f]{24}$/i.test(s));
  const ps = await db
    .collection('passages')
    .find({ _id: { $in: ids.map((s) => new ObjectId(s)) } })
    .project({ [`content.${field}`]: 1 })
    .toArray();
  return new Map(ps.map((p) => [String(p._id), ((p.content ?? {}) as Doc)[field]]));
}

async function applyUpdates(ctx: Ctx, kind: string, updates: Update[]): Promise<void> {
  console.log(`\n변경 대상 ${updates.length}건`);
  if (!ctx.apply) {
    console.log('[dry-run] 적용하려면 --apply');
    return;
  }
  if (!updates.length) return;
  const backup = writeVariantBackup(
    `answer-seq-${kind}-${ctx.orderNumber}`,
    updates.map((u) => ({ _id: String(u.id), source: u.source, type: u.type, before: u.before })),
  );
  let n = 0;
  for (const u of updates) {
    n += (await ctx.db.collection('generated_questions').updateOne({ _id: u.id }, { $set: u.set })).modifiedCount;
  }
  console.log(`적용 ${n}/${updates.length} · 백업 ${backup}`);
}

async function runCheck(ctx: Ctx): Promise<void> {
  for (const t of ctx.scope.targets) {
    console.log(`\n═══ ${ctx.orderNumber} | ${t.textbook} | ${t.label} | 지문 ${t.sources.length}`);
    for (const type of ctx.scope.types) {
      const rows = await fetchOrderQuestions(ctx.db, t, type, { perSource: ctx.scope.perType(type) });
      const seq = rows.map((r) => r.answer);
      const statuses = [...new Set(rows.map((r) => str(r.doc.status)))].join('/') || '-';
      const tail = isSingleAnswerSequence(seq) ? describeSequence(seq) : '복수 정답·서술형 — 정답열 점검 제외';
      console.log(`  ${type}: ${rows.length}/${t.sources.length * ctx.scope.perType(type)} (${statuses})  ${tail}`);
    }
  }
}

async function runOrder(ctx: Ctx): Promise<void> {
  const listOnly = ctx.args.includes('--list');
  const updates: Update[] = [];
  for (const t of ctx.scope.targets) {
    for (const type of ctx.scope.types.filter((x) => /^순서/.test(x))) {
      const rows = await fetchOrderQuestions(ctx.db, t, type, { perSource: ctx.scope.perType(type) });
      const originals = await passageContent(ctx.db, rows, 'original');
      const originalOf = (r: OrderQuestionRow) => str(originals.get(str(r.doc.passage_id)));
      const derived = rows.map((r) => orderAnswerFromText(str(r.qd.Paragraph), originalOf(r)));
      if (listOnly) {
        rows.forEach((r, i) => console.log(`LIST\t${r.source}\t${r.answer}\t${derived[i] ?? '-'}`));
        continue;
      }
      console.log(`\n═══ ${ctx.orderNumber} | ${t.textbook} | ${type} ${rows.length}문항`);
      rows.forEach((r, i) => {
        if (derived[i] !== r.answer) {
          console.log(`  ⚠ 본문-정답 불일치·파싱 실패(교정 제외): ${r.source} CA=${r.answer} 본문=${derived[i] ?? '?'}`);
        }
      });
      const seq = rows.map((r) => r.answer);
      const plan = planAnswerSequence(seq, (i) => (derived[i] === rows[i].answer ? ANY_TARGET : NO_TARGET));
      console.log(`  현재 ${describeSequence(seq)}`);
      console.log(`  교정 ${describeSequence(plan)}`);
      rows.forEach((r, i) => {
        if (plan[i] === seq[i]) return;
        const res = relabelOrderQuestion(r.qd, originalOf(r), plan[i]);
        if (!res || !res.verified) {
          console.log(`  ⚠ ${r.source}: 라벨 치환 검증 실패 — 건너뜀`);
          return;
        }
        const flag = res.flags.length ? `  ⚑ ${res.flags.join(' / ')} (적용 안 함 — 해설 확인)` : '';
        console.log(`\n── ${r.source}  ${seq[i]}→${plan[i]}${flag}`);
        console.log(`  [해설 후] ${res.explanation.replace(/\n/g, ' ⏎ ')}`);
        if (res.flags.length) return;
        updates.push({
          id: r.doc._id as ObjectId,
          source: r.source,
          type,
          set: {
            'question_data.Paragraph': res.paragraph,
            'question_data.CorrectAnswer': plan[i],
            'question_data.Explanation': res.explanation,
          },
          before: { Paragraph: r.qd.Paragraph, CorrectAnswer: r.qd.CorrectAnswer, Explanation: r.qd.Explanation },
        });
      });
    }
  }
  if (!listOnly) await applyUpdates(ctx, 'order', updates);
}

async function runInsert(ctx: Ctx): Promise<void> {
  const locks = listArg(ctx.args, '--lock');
  const relaxed = ctx.args.includes('--relaxed');
  const updates: Update[] = [];
  const drafts: Doc[] = [];
  const flagged: Doc[] = [];
  for (const t of ctx.scope.targets) {
    for (const type of ctx.scope.types.filter((x) => /^삽입/.test(x))) {
      const rows = await fetchOrderQuestions(ctx.db, t, type, { perSource: ctx.scope.perType(type) });
      const sentenceMap = await passageContent(ctx.db, rows, 'sentences_en');
      const sentencesOf = (r: OrderQuestionRow) => asStrings(sentenceMap.get(str(r.doc.passage_id)));
      const layouts: (InsertionLayout | null)[] = rows.map((r) => parseInsertionParagraph(str(r.qd.Paragraph), sentencesOf(r)));
      const correct = rows.map((r, i) => {
        const k = CIRCLED_LIST.indexOf(r.answer);
        const layout = layouts[i];
        return layout && k >= 0 ? layout.marks[k] : -1;
      });
      const options = rows.map((r, i): Map<string, InsertionOption> => {
        const layout = layouts[i];
        if (!layout || correct[i] < 0 || locks.some((l) => r.source.includes(l))) return new Map();
        return insertionMarkerOptions(layout, correct[i], str(r.qd.Explanation), relaxed);
      });
      const note = `${locks.length ? ` | 고정 ${locks.join(',')}` : ''}${relaxed ? ' | relaxed' : ''}`;
      console.log(`\n═══ ${ctx.orderNumber} | ${t.textbook} | ${type} ${rows.length}문항${note}`);
      rows.forEach((r, i) => {
        if (!layouts[i] || correct[i] < 0) console.log(`  ⚠ 파싱 실패(교정 제외): ${r.source} CA=${r.answer}`);
      });
      const seq = rows.map((r) => r.answer);
      const plan = planAnswerSequence(seq, (i) => new Map([...options[i]].map(([v, o]): [string, number] => [v, o.cost])));
      console.log(`  현재 ${describeSequence(seq)}`);
      console.log(`  교정 ${describeSequence(plan)}`);
      rows.forEach((r, i) => {
        if (plan[i] === seq[i]) return;
        const layout = layouts[i];
        const option = options[i].get(plan[i]);
        if (!layout || !option) return;
        const res = rewriteInsertionQuestion(r.qd, layout, sentencesOf(r), correct[i], option.markers);
        const ok = res.verified && res.answer === plan[i];
        const flag = res.flags.length ? `  ⚑ ${res.flags.join(' / ')}` : '';
        console.log(`\n── ${r.source}  ${seq[i]}→${plan[i]}  비용 ${option.cost.toFixed(2)}  검증 ${ok ? 'OK' : '실패'}${flag}`);
        console.log(`  [전] ${describeInsertionMarkers(layout, layout.marks)}`);
        console.log(`  [후] ${describeInsertionMarkers(layout, option.markers)}`);
        console.log(`  [해설 후] ${res.explanation.replace(/\n/g, ' ⏎ ')}`);
        if (!ok) return;
        const draft = {
          passage_id: str(r.doc.passage_id),
          textbook: t.textbook,
          source: r.source,
          type,
          question_data: { ...r.qd, Paragraph: res.paragraph, CorrectAnswer: plan[i], Explanation: res.explanation },
        };
        if (res.flags.length) {
          flagged.push({ serialNo: r.doc.serialNo, flags: res.flags, draft });
          return;
        }
        drafts.push(draft);
        updates.push({
          id: r.doc._id as ObjectId,
          source: r.source,
          type,
          set: {
            'question_data.Paragraph': res.paragraph,
            'question_data.CorrectAnswer': plan[i],
            'question_data.Explanation': res.explanation,
          },
          before: { Paragraph: r.qd.Paragraph, CorrectAnswer: r.qd.CorrectAnswer, Explanation: r.qd.Explanation },
        });
      });
    }
  }
  if (drafts.length) console.log(`\nprevalidate 용 초안: ${writeVariantDraft(`${ctx.orderNumber}-insert`, drafts)}`);
  if (flagged.length) {
    const file = writeVariantDraft(`${ctx.orderNumber}-insert-flagged`, flagged);
    console.log(`해설 수기 수정 필요 ${flagged.length}건: ${file} (고친 뒤 prevalidate → patch-question-data 로 적용)`);
  }
  await applyUpdates(ctx, 'insert', updates);
}

async function runShuffled(ctx: Ctx): Promise<void> {
  const typeArg = listArg(ctx.args, '--types');
  const types = (typeArg.length ? typeArg : ctx.scope.types).filter((x) => SHUFFLABLE_TYPES.has(x));
  /* 같은 번호를 열에서 몇 개까지 허용할지. 기본은 balanceCapFor — 6문항이면 3 이라
     「③④③②③④」처럼 한 번호가 셋인 열이 상한에 걸치지 않아 그대로 남는다.
     더 촘촘히 흩어야 할 때 `--cap 2` 로 낮춘다(2026-09-12 요청). */
  const capIdx = ctx.args.indexOf('--cap');
  const capRaw = capIdx >= 0 ? Number(ctx.args[capIdx + 1]) : NaN;
  const capOverride = Number.isFinite(capRaw) && capRaw >= 1 ? Math.floor(capRaw) : null;
  const updates: Update[] = [];
  for (const t of ctx.scope.targets) {
    for (const type of types) {
      const rows = await fetchOrderQuestions(ctx.db, t, type, { perSource: ctx.scope.perType(type) });
      const seq = rows.map((r) => r.answer);
      console.log(`\n═══ ${ctx.orderNumber} | ${t.textbook} | ${type} ${rows.length}문항`);
      if (!isSingleAnswerSequence(seq)) {
        console.log('  정답이 ①~⑤ 한 개가 아닌 문항이 있어 건너뜀');
        continue;
      }
      const plan = planAnswerSequence(seq, () => ANY_TARGET, capOverride ?? balanceCapFor(seq.length));
      console.log(`  현재 ${describeSequence(seq)}`);
      console.log(`  교정 ${describeSequence(plan)}`);
      rows.forEach((r, i) => {
        if (plan[i] === seq[i]) return;
        const res = swapShuffledAnswer(r.qd, plan[i]);
        if (!res || !res.verified) {
          console.log(`  ⚠ ${r.source}: 보기 형식 때문에 맞바꿀 수 없음`);
          return;
        }
        console.log(`  ── ${r.source}  ${seq[i]}→${plan[i]}  해설: ${res.explanation.replace(/\n/g, ' ').slice(0, 70)}…`);
        updates.push({
          id: r.doc._id as ObjectId,
          source: r.source,
          type,
          set: {
            'question_data.Options': res.options,
            'question_data.CorrectAnswer': res.correctAnswer,
            'question_data.Explanation': res.explanation,
          },
          before: { Options: r.qd.Options, CorrectAnswer: r.qd.CorrectAnswer, Explanation: r.qd.Explanation },
        });
      });
    }
  }
  await applyUpdates(ctx, 'shuffled', updates);
}

const COMMANDS = new Map<string, (ctx: Ctx) => Promise<void>>([
  ['check', runCheck],
  ['order', runOrder],
  ['insert', runInsert],
  ['shuffled', runShuffled],
]);

async function main(): Promise<void> {
  const [cmd = '', ...args] = process.argv.slice(2);
  const orderNumber = args.find((a) => /^[A-Z]{2}-\d{8}-\d{3,}$/.test(a));
  const run = COMMANDS.get(cmd);
  if (!run || !orderNumber) {
    console.log(
      [
        '사용법:',
        '  npm run cc:answer-seq -- check    <주문번호>',
        '  npm run cc:answer-seq -- order    <주문번호> [--list] [--apply]',
        '  npm run cc:answer-seq -- insert   <주문번호> [--lock "09회 25번,08회 38번"] [--relaxed] [--apply]',
        '  npm run cc:answer-seq -- shuffled <주문번호> [--types 빈칸-고난도,주제-고난도] [--cap 2] [--apply]',
      ].join('\n'),
    );
    process.exit(1);
  }
  const db = await getDb('gomijoshua');
  const order = (await db.collection('orders').findOne({ orderNumber })) as Doc | null;
  if (!order) throw new Error(`${orderNumber}: 주문 없음`);
  const scope = resolveOrderQuestionScope(order);
  if (!scope.targets.length) throw new Error(`${orderNumber}: 주문 범위(교재·지문)를 읽지 못했습니다`);
  await run({ db, orderNumber, scope, apply: args.includes('--apply'), args });
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
