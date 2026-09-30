import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/lib/mongodb';
import { DEFAULT_MEMBER_INITIAL_PASSWORD } from '@/lib/auth';
import { COUPONS_COLLECTION } from '@/lib/coupons';
import {
  listApplications,
  type MembershipApplicationStatus,
} from '@/lib/membership-applications-store';

const VALID_STATUSES: MembershipApplicationStatus[] = ['pending', 'contacted', 'completed', 'rejected'];

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const sp = request.nextUrl.searchParams;
  /* `status=pending` 한 개도 되고 `status=pending,contacted` 처럼 여러 개도 된다.
     대시보드는 「미처리」(대기+연락완료)를 한 번에 받아야 한다 — 예전처럼 pending 만 받으면
     연락완료로 넘어간 신청서가 목록에서 사라져 계정을 만들 방법이 없어진다. */
  const statuses = (sp.get('status') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is MembershipApplicationStatus =>
      VALID_STATUSES.includes(s as MembershipApplicationStatus),
    );
  const search = sp.get('search') ?? '';
  const limit = Math.min(parseInt(sp.get('limit') ?? '50', 10), 200);

  const result = await listApplications({
    status: statuses.length === 0 ? undefined : statuses.length === 1 ? statuses[0] : statuses,
    search: search || undefined,
    limit,
  });

  /* 처리된 신청서는 이름·전화가 마스킹돼 있다 — 이 신청서로 만든 계정(users.createdFromApplicationId)의
     이름·로그인 ID(=전화번호)를 붙여 관리자 화면에서 온전히 보이고, 가입 인사 문구를 만들 수 있게 한다. */
  const items = result.applications as unknown as ({ id: string } & Record<string, unknown>)[];
  if (items.length) {
    const db = await getDb('gomijoshua');
    const users = await db
      .collection('users')
      .find({ createdFromApplicationId: { $in: items.map((a) => a.id) } })
      .project({ name: 1, loginId: 1, createdFromApplicationId: 1 })
      .toArray();
    const coupons = users.length
      ? await db
          .collection(COUPONS_COLLECTION)
          .find({ userId: { $in: users.map((u) => u._id as ObjectId) }, note: '가입 환영 쿠폰' })
          .project({ userId: 1, discountPct: 1 })
          .toArray()
      : [];
    const couponBy = new Map(coupons.map((c) => [String(c.userId), Number(c.discountPct) || 0]));
    const byApp = new Map(
      users.map((u) => [
        String(u.createdFromApplicationId),
        { id: String(u._id), name: String(u.name ?? ''), loginId: String(u.loginId ?? ''), couponPct: couponBy.get(String(u._id)) ?? 0 },
      ]),
    );
    for (const a of items as ({ id: string } & Record<string, unknown>)[]) {
      const acc = byApp.get(a.id);
      if (acc) a.account = acc;
    }
  }
  return NextResponse.json({ ...result, initialPassword: DEFAULT_MEMBER_INITIAL_PASSWORD });
}
