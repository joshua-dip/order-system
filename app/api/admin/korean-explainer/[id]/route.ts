import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import {
  deleteKoreanExplanation,
  getKoreanExplanation,
} from '@/lib/korean-explanations-store';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { id } = await params;
  const doc = await getKoreanExplanation(id);
  if (!doc) return NextResponse.json({ error: '해설지가 없습니다.' }, { status: 404 });
  return NextResponse.json({ doc });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { id } = await params;
  const ok = await deleteKoreanExplanation(id);
  if (!ok) return NextResponse.json({ error: '해설지가 없습니다.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
