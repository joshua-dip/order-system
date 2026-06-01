import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/lib/mongodb';
import { revokeCoupon } from '@/lib/coupons';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** DELETE — 활성 쿠폰 회수 (active → revoked). 이미 사용/회수된 쿠폰은 불가. */
export async function DELETE(request: NextRequest, ctx: Ctx) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { id } = await ctx.params;
  try {
    const db = await getDb('gomijoshua');
    const ok = await revokeCoupon(db, id);
    if (!ok) {
      return NextResponse.json({ error: '회수할 수 없는 쿠폰입니다 (이미 사용·회수됨).' }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[admin/coupons DELETE]', e);
    return NextResponse.json({ error: '쿠폰 회수 실패' }, { status: 500 });
  }
}
