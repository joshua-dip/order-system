import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import {
  createAccountFromApplication,
  CREATE_ACCOUNT_STATUS,
} from '@/lib/membership-application-account';

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { error, payload } = await requireAdmin(request);
  if (error) return error;

  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const db = await getDb('gomijoshua');
  const result = await createAccountFromApplication(db, {
    applicationId: id,
    grantCouponPct: body?.grantCouponPct,
    issuedBy: payload?.loginId ?? 'admin',
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message, ...(result.loginId ? { loginId: result.loginId } : {}) },
      { status: CREATE_ACCOUNT_STATUS[result.reason] },
    );
  }

  return NextResponse.json({
    ok: true,
    userId: result.userId,
    loginId: result.loginId,
    name: result.name,
    initialPassword: result.initialPassword,
    couponGrantedPct: result.couponGrantedPct,
  });
}
