import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const db = await getDb('gomijoshua');
    const textbooks = await db.collection('passages').distinct('textbook');
    const sorted = (textbooks as string[]).filter(Boolean).sort((a, b) => a.localeCompare(b, 'ko'));
    return NextResponse.json({ textbooks: sorted });
  } catch (e) {
    console.error('passages textbooks:', e);
    return NextResponse.json({ error: '조회에 실패했습니다.' }, { status: 500 });
  }
}
