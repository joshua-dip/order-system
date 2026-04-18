import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { promoteGuestLog } from '@/lib/guest-variant-logs-promote';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, payload } = await requireAdmin(request);
  if (error) return error;

  const { id } = await params;

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) ?? {};
  } catch {
    body = {};
  }

  const statusRaw = typeof body.status === 'string' ? body.status.trim() : '대기';
  const status: '대기' | '완료' = statusRaw === '완료' ? '완료' : '대기';
  const overrideQuestionData =
    body.question_data && typeof body.question_data === 'object' && !Array.isArray(body.question_data)
      ? (body.question_data as Record<string, unknown>)
      : undefined;

  const result = await promoteGuestLog(id, {
    status,
    overrideQuestionData,
    adminLoginId: payload?.loginId,
  });

  if (!result.ok) {
    const code =
      result.code === 'not_found'
        ? 404
        : result.code === 'not_matched'
          ? 409
          : result.code === 'already_exists' || result.code === 'already_promoted'
            ? 409
            : 500;
    return NextResponse.json({ error: result.error, code: result.code }, { status: code });
  }

  return NextResponse.json(result);
}
