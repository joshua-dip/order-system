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
  const status = sp.get('status') as MembershipApplicationStatus | null;
  const search = sp.get('search') ?? '';
  const limit = Math.min(parseInt(sp.get('limit') ?? '50', 10), 200);

  const result = await listApplications({
    status: status && VALID_STATUSES.includes(status) ? status : undefined,
    search: search || undefined,
    limit,
  });

  return NextResponse.json(result);
}
