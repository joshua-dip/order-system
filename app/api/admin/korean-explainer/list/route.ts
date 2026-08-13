import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import {
  listFolders,
  listKoreanExplanations,
  listTextbooks,
} from '@/lib/korean-explanations-store';

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const url = new URL(request.url);
  const textbook = url.searchParams.get('textbook') ?? undefined;
  const folder = url.searchParams.get('folder') ?? undefined;

  const [items, folders, textbooks] = await Promise.all([
    listKoreanExplanations({ textbook, folder }),
    listFolders(),
    listTextbooks(),
  ]);

  return NextResponse.json({ items, folders, textbooks });
}
