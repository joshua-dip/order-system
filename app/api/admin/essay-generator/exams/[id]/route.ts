import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getEssayExam, updateEssayExam, deleteEssayExam, moveExamOrder } from '@/lib/essay-exams-store';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { id } = await params;
  const doc = await getEssayExam(id);
  if (!doc) return NextResponse.json({ error: '없음' }, { status: 404 });

  return NextResponse.json({ item: doc });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { id } = await params;
  let body: { html?: string; data?: object; folder?: string; move?: 'up' | 'down' };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: '형식 오류' }, { status: 400 });
  }

  if (body.move === 'up' || body.move === 'down') {
    const ok = await moveExamOrder(id, body.move);
    return NextResponse.json({ ok });
  }

  const ok = await updateEssayExam(id, body);
  if (!ok) return NextResponse.json({ error: '없음' }, { status: 404 });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { id } = await params;
  const ok = await deleteEssayExam(id);
  if (!ok) return NextResponse.json({ error: '없음' }, { status: 404 });

  return NextResponse.json({ ok: true });
}
