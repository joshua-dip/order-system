import type { Db, ObjectId } from 'mongodb';
import { recordPointLedger } from './point-ledger';

/**
 * 관리자가 회원 대신 포인트를 「사용」으로 차감한다 — 사유(note)가 회원 포인트 내역 비고에 그대로 보인다.
 *
 * 쓰임새: 이미 받은 주문을 포인트로 정산해 달라는 경우 등(2026-09-10 안수경 선생님 60,000P).
 * 회수(admin_recall)와 다른 점 —
 *  - 회원 화면에 「포인트 회수」가 아니라 「포인트 사용」으로 보인다.
 *  - 잔액이 모자라면 거절한다. 회수는 0까지 깎지만, 사용은 실제로 쓴 만큼이어야 한다.
 * 차감은 조건부 원자 갱신(`points >= amount`)이다 — 그 사이 주문으로 잔액이 줄어도 음수가 되지 않는다.
 */
export async function adminSpendPoints(
  db: Db,
  input: { userId: ObjectId; amount: number; note: string; adminUserId?: string },
): Promise<{ ok: true; balanceAfter: number } | { ok: false; error: string }> {
  const amount = Math.floor(input.amount);
  const note = input.note.trim().slice(0, 100);
  if (!(amount > 0)) return { ok: false, error: '사용 처리할 포인트를 입력하세요.' };
  if (!note) return { ok: false, error: '사용 내용을 입력하세요. (회원 포인트 내역에 그대로 보입니다)' };

  const users = db.collection('users');
  const after = await users.findOneAndUpdate(
    { _id: input.userId, points: { $gte: amount } },
    { $inc: { points: -amount } },
    { returnDocument: 'after', projection: { points: 1 } },
  );
  if (!after) {
    const cur = await users.findOne({ _id: input.userId }, { projection: { points: 1 } });
    if (!cur) return { ok: false, error: '회원을 찾을 수 없습니다.' };
    const p = typeof cur.points === 'number' ? cur.points : 0;
    return {
      ok: false,
      error: `보유 포인트(${p.toLocaleString()}P)가 부족합니다. 사용 요청: ${amount.toLocaleString()}P`,
    };
  }
  const balanceAfter = typeof after.points === 'number' ? after.points : 0;
  await recordPointLedger(db, {
    userId: input.userId,
    delta: -amount,
    balanceAfter,
    kind: 'admin_spend',
    meta: { ...(input.adminUserId ? { adminUserId: input.adminUserId } : {}), spendPoints: amount, note },
  });
  return { ok: true, balanceAfter };
}
