/**
 * 비회원 주문의 회원 소급 배정.
 *
 *   npx tsx scripts/backfill-order-member-by-email.ts            # 미리보기
 *   npx tsx scripts/backfill-order-member-by-email.ts --apply
 *
 * 로그인 없이 들어온 주문이라도, 자료 받을 이메일이 **예전에 회원으로 주문할 때 쓴 것과 같으면**
 * 같은 사람으로 보고 그 회원에게 붙인다. (계정 이메일과 수신 이메일이 다른 경우가 많아
 * users.email 이 아니라 주문 이력을 근거로 삼는다.)
 *
 * 추정 배정이므로 loginIdSource:'email-match' 를 함께 남겨 인증된 주문과 구분한다.
 * 포인트·결제에는 손대지 않는다 — 화면 표시와 집계용 연결만 한다.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCliEnv } from './_cli-env';

loadCliEnv(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));

import { getDb } from '@/lib/mongodb';

const apply = process.argv.includes('--apply');

async function main() {
  const db = await getDb('gomijoshua');
  const O = db.collection('orders');
  const U = db.collection('users');

  const anon = await O.find({
    $or: [{ loginId: { $exists: false } }, { loginId: null }, { loginId: '' }],
  }).sort({ createdAt: -1 }).toArray();

  console.log(`비회원 주문 ${anon.length}건 검사\n`);

  let matched = 0;
  const noEmail: string[] = [];
  const noHistory: string[] = [];

  for (const o of anon) {
    const meta = (o.orderMeta ?? {}) as Record<string, unknown>;
    const em = typeof meta.email === 'string' ? meta.email.trim() : '';
    if (!em) { noEmail.push(String(o.orderNumber)); continue; }

    const esc = em.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const prior = await O.findOne(
      {
        'orderMeta.email': { $regex: `^${esc}$`, $options: 'i' },
        loginId: { $exists: true, $nin: [null, ''] },
      },
      { projection: { loginId: 1, orderNumber: 1 }, sort: { createdAt: -1 } },
    );
    const found = typeof prior?.loginId === 'string' ? prior.loginId.trim() : '';
    if (!found) { noHistory.push(`${o.orderNumber} (${em})`); continue; }

    const u = await U.findOne({ loginId: found }, { projection: { name: 1 } });
    matched++;
    console.log(`  ${String(o.orderNumber).padEnd(20)} ${em.padEnd(28)} → ${u?.name ?? '?'} (${found})`);
    if (apply) {
      await O.updateOne({ _id: o._id }, { $set: { loginId: found, loginIdSource: 'email-match' } });
    }
  }

  console.log(`\n매칭 ${matched}건 · 이메일 없음 ${noEmail.length}건 · 이력 없음 ${noHistory.length}건`);
  if (noHistory.length) console.log('  이력 없음:', noHistory.join(', '));
  if (noEmail.length) console.log('  이메일 없음:', noEmail.join(', '));
  console.log(apply ? '\n✅ 적용 완료' : '\n미리보기입니다. 적용하려면 --apply 를 붙이세요.');
}

main().catch((e) => { console.error('실패:', e); process.exit(1); });
