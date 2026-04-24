import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import {
  updateApplicationStatus,
  deleteApplication,
  type MembershipApplicationStatus,
} from '@/lib/membership-applications-store';

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { id } = await params;
  let body: { action?: string; adminMemo?: string };
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
