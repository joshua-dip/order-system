import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { removeBlocklistEntry } from '@/lib/guest-variant-blocklist';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requireAdmin(request);
  if (error) return error;
  const { id } = await params;
  const r = await removeBlocklistEntry(id);
  if (!r.ok) return NextResponse.json({ error: r.error || '삭제 실패' }, { status: 400 });
  return NextResponse.json({ ok: true });
}
