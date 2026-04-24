import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { listSolbookLinks } from '@/lib/solbook-lesson-links-store';

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const list = await listSolbookLinks();
  return NextResponse.json({ items: list });
}
