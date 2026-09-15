import { loadCliEnv } from './_cli-env';
loadCliEnv(process.cwd());
import fs from 'node:fs';
import path from 'node:path';
import type { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { POINT_LEDGER_COLLECTION } from '@/lib/point-ledger';
import { parseDepositDueFromOrderText } from '@/lib/order-revenue';
import {
  applyPointsToOrderText,
  hasPointUsageLine,
  orderAmountDueBeforePoints,
  shouldConfirmPaymentAfterPoints,
} from '@/lib/order-point-payment';

/**
 * 포인트로 결제된 주문의 주문서·상태를 바로잡는다 — 기본 dry-run, --apply 로 적용.
 *
 * ① 관리자 「포인트 결제」로 처리된 주문(point_ledger order_spend 의 meta.byAdmin)
 *    예전 코드는 포인트만 깎아 주문서에 「포인트 사용」 줄이 없고 「입금하실 금액」이 전액으로 남았다.
 *    → 주문서를 회원이 직접 포인트를 쓴 것과 같은 모양으로 고치고, 낼 금액이 0원이면 입금 전 단계를
 *      「입금 확인」으로 올린다. 지금의 payWithPoints(app/api/orders/[id])와 같은 규칙이다.
 * ② 회원이 주문서에서 포인트로 전액 결제했는데 「주문 접수」로 남은 주문(0원 자동 입금확인 도입 전)
 *    → 접수 때 규칙과 같이 「입금 확인」 + paymentAutoConfirmed.
 *
 *   npx tsx scripts/backfill-point-paid-orders.ts [--all-statuses] [--apply]
 *
 * 기본은 입금 전 단계(주문 접수·주문 확인) 주문만 본다.
 * --all-statuses 는 제작 중·완료 주문의 주문서도 ①처럼 고친다 — 실입금 매출에서 포인트분이 빠지므로
 * 지난 매출 숫자가 달라진다. 상태는 어느 경우든 입금 전 단계만 바꾼다.
 */

type Doc = Record<string, unknown>;
const PRE_PAYMENT = ['pending', 'accepted'];
const won = (n: number): string => n.toLocaleString('ko-KR');

interface Plan {
  id: ObjectId;
  set: Doc;
  before: Doc;
  note: string;
  lines: string[];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const allStatuses = args.includes('--all-statuses');
  const db = await getDb('gomijoshua');
  const orders = db.collection('orders');

  const statusFilter: Doc = allStatuses
    ? { status: { $ne: 'cancelled' } }
    : { $or: [{ status: { $in: PRE_PAYMENT } }, { status: { $exists: false } }, { status: null }] };
  const list = (await orders
    .find({ pointsUsed: { $gt: 0 }, ...statusFilter })
    .project({ orderNumber: 1, orderText: 1, orderMeta: 1, status: 1, pointsUsed: 1, createdAt: 1 })
    .sort({ createdAt: -1 })
    .toArray()) as Doc[];

  const spends = (await db
    .collection(POINT_LEDGER_COLLECTION)
    .find({ kind: 'order_spend', 'meta.orderId': { $in: list.map((o) => String(o._id)) } })
    .project({ meta: 1 })
    .toArray()) as Doc[];
  const paidByAdmin = new Set(
    spends
      .map((l) => (l.meta ?? {}) as Doc)
      .filter((m) => !!m.byAdmin)
      .map((m) => String(m.orderId)),
  );

  const now = new Date();
  const plans: Plan[] = [];
  const skipped: string[] = [];
  for (const o of list) {
    const status = typeof o.status === 'string' && o.status ? o.status : 'pending';
    const points = Math.floor(Number(o.pointsUsed));
    const text = typeof o.orderText === 'string' ? o.orderText : '';
    const byAdmin = paidByAdmin.has(String(o._id));
    const date = o.createdAt instanceof Date ? o.createdAt.toISOString().slice(0, 10) : '';
    const head = `${String(o.orderNumber ?? o._id)} ${date} ${status} ${won(points)}P ${byAdmin ? '관리자 결제' : '회원 결제'}`;

    if (!hasPointUsageLine(text)) {
      if (!byAdmin) {
        skipped.push(`${head} — 주문서에 포인트 줄이 없는데 관리자 결제 기록도 없음(수동 확인)`);
        continue;
      }
      const dueBefore = orderAmountDueBeforePoints(text, o.orderMeta);
      if (dueBefore == null) {
        skipped.push(`${head} — 주문서 금액을 읽지 못함`);
        continue;
      }
      const applied = applyPointsToOrderText(text, points, dueBefore);
      const confirm = shouldConfirmPaymentAfterPoints(status, applied.dueAfter);
      plans.push({
        id: o._id as ObjectId,
        set: { orderText: applied.text, ...(confirm && { status: 'payment_confirmed', paymentConfirmedAt: now }) },
        before: { orderText: text, status: o.status ?? null },
        note: `${head} — 입금하실 금액 ${won(dueBefore)}원 → ${won(applied.dueAfter)}원${confirm ? ' · 「입금 확인」으로' : ''}`,
        lines: applied.text.split('\n').filter((l) => /포인트\s*사용|입금하실\s*금액/.test(l)),
      });
      continue;
    }

    const due = parseDepositDueFromOrderText(text);
    if (due !== 0) {
      skipped.push(`${head} — 포인트를 쓰고도 입금하실 금액 ${due == null ? '?' : won(due)}원이 남음`);
      continue;
    }
    if (!shouldConfirmPaymentAfterPoints(status, 0)) continue;
    plans.push({
      id: o._id as ObjectId,
      set: { status: 'payment_confirmed', paymentConfirmedAt: now, paymentAutoConfirmed: !byAdmin, expectedDepositWon: 0 },
      before: { status: o.status ?? null },
      note: `${head} — 주문서 입금액 0원 · 「입금 확인」으로`,
      lines: [],
    });
  }

  console.log(`포인트 사용 주문 ${list.length}건 (${allStatuses ? '취소 제외 전체' : '입금 전 단계'}) · 고칠 것 ${plans.length} · 건너뜀 ${skipped.length}`);
  for (const p of plans) {
    console.log(`  ✎ ${p.note}`);
    for (const l of p.lines) console.log(`      | ${l}`);
  }
  for (const s of skipped) console.log(`  · ${s}`);

  if (!apply) {
    console.log('\n[dry-run] 적용하려면 --apply');
    process.exit(0);
  }
  if (!plans.length) process.exit(0);
  const dir = path.join(process.cwd(), 'scripts', '.backups');
  fs.mkdirSync(dir, { recursive: true });
  const backup = path.join(dir, `point-paid-orders-${Date.now()}.json`);
  fs.writeFileSync(backup, JSON.stringify(plans.map((p) => ({ _id: String(p.id), before: p.before })), null, 1));
  let n = 0;
  for (const p of plans) n += (await orders.updateOne({ _id: p.id }, { $set: p.set })).modifiedCount;
  console.log(`\n적용 ${n}/${plans.length} · 백업 ${backup}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
