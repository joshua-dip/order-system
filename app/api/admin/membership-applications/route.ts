import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
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

  return NextResponse.json(result);
}
