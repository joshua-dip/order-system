import { loadCliEnv } from './_cli-env';
loadCliEnv(process.cwd());
import { getDb } from '@/lib/mongodb';
import { fetchOrderQuestions, resolveOrderQuestionScope } from '@/lib/order-answer-sequence';

/**
 * 주문 범위 문항 보기 (read-only) — 인쇄 순서(출처 순) 목록과, 출처를 지정하면 그 문항의 발문·본문·보기·해설 전문.
 * 에이전트가 「모호할 수 있다」고 표시한 문항을 사람이 다시 볼 때 쓴다.
 *
 *   npx tsx scripts/dump-order-questions.ts <주문번호> <유형> ["08회 36번,09회 30번"]
 */

type Doc = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

async function main(): Promise<void> {
  const [orderNumber, type, filter = ''] = process.argv.slice(2);
  if (!orderNumber || !type) {
    console.log('사용법: npx tsx scripts/dump-order-questions.ts <주문번호> <유형> ["출처 일부,출처 일부"]');
    process.exit(1);
  }
  const wanted = filter.split(',').map((s) => s.trim()).filter(Boolean);
  const db = await getDb('gomijoshua');
  const order = (await db.collection('orders').findOne({ orderNumber })) as Doc | null;
  if (!order) throw new Error(`${orderNumber}: 주문 없음`);
  const scope = resolveOrderQuestionScope(order);
  for (const target of scope.targets) {
    /* 주문 수량(유형당 N문항)만큼 — 인쇄·정답열 교정과 같은 순서로 번호를 매긴다. */
    const rows = await fetchOrderQuestions(db, target, type, { perSource: scope.perType(type) });
    console.log(`═══ ${orderNumber} | ${target.textbook} | ${type} ${rows.length}문항`);
    rows.forEach((r, i) => {
      const hit = wanted.some((w) => r.source.includes(w));
      if (wanted.length && !hit) return;
      console.log(
        `#${i} ${r.source} 정답=${r.answer} serial=${str(r.doc.serialNo)} status=${str(r.doc.status)} passage=${str(r.doc.passage_id)}`,
      );
      if (!hit) return;
      console.log(`  [Q] ${str(r.qd.Question)}`);
      console.log(`  [P] ${JSON.stringify(str(r.qd.Paragraph))}`);
      console.log(`  [O] ${JSON.stringify(str(r.qd.Options))}`);
      console.log(`  [E] ${JSON.stringify(str(r.qd.Explanation))}`);
    });
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
