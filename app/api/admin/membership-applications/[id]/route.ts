import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/lib/mongodb';
import { createAccountFromApplication } from '@/lib/membership-application-account';
import {
  updateApplicationStatus,
  deleteApplication,
  type MembershipApplicationStatus,
} from '@/lib/membership-applications-store';

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const { error, payload } = await requireAdmin(request);
  if (error) return error;

  const { id } = await params;
  let body: { action?: string; adminMemo?: string; grantCouponPct?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '요청 형식이 올바르지 않습니다.' }, { status: 400 });
  }

  const ACTION_MAP: Record<string, MembershipApplicationStatus | 'updateMemo'> = {
    markContacted: 'contacted',
    markCompleted: 'completed',
    markRejected: 'rejected',
    markPending: 'pending',
    updateMemo: 'updateMemo',
  };

  const action = body.action ?? '';
  if (!ACTION_MAP[action]) {
    return NextResponse.json({ error: '올바르지 않은 액션입니다.' }, { status: 400 });
  }

  const ok = await updateApplicationStatus(id, ACTION_MAP[action], body.adminMemo);
  if (!ok) {
    return NextResponse.json({ error: '신청서를 찾을 수 없습니다.' }, { status: 404 });
  }

  /**
   * 연락완료는 곧 가입 처리다 — 연락을 기록한 뒤 **계정까지 만든다.**
   *
   * 예전에는 연락완료가 상태만 바꿨고, 그러면 관리자 대시보드의 가입 승인 패널이
   * `status=pending` 만 조회하는 탓에 그 신청서가 목록에서 사라져 계정을 만들 길이 없었다
   * (2026-09-12 실제로 그래서 신청자 한 명이 방치됐다).
   *
   * 계정 생성이 실패해도 연락 기록은 그대로 둔다 — 실패 사유만 `account` 로 돌려준다.
   */
  if (action === 'markContacted') {
    const db = await getDb('gomijoshua');
    const account = await createAccountFromApplication(db, {
      applicationId: id,
      grantCouponPct: body.grantCouponPct,
      issuedBy: payload?.loginId ?? 'admin',
    });
    return NextResponse.json({ ok: true, account });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { id } = await params;
  const ok = await deleteApplication(id);
  if (!ok) {
    return NextResponse.json({ error: '신청서를 찾을 수 없습니다.' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
