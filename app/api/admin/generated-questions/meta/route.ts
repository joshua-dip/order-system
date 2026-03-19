import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const db = await getDb('gomijoshua');
    const col = db.collection('generated_questions');
    const [textbooks, types, statuses] = await Promise.all([
      col.distinct('textbook'),
      col.distinct('type'),
      col.distinct('status'),
    ]);
    return NextResponse.json({
      textbooks: (textbooks as string[]).filter(Boolean).sort((a, b) => a.localeCompare(b, 'ko')),
      types: (types as string[]).filter(Boolean).sort((a, b) => a.localeCompare(b, 'ko')),
      statuses: (statuses as string[]).filter(Boolean).sort((a, b) => a.localeCompare(b, 'ko')),
    });
  } catch (e) {
    console.error('generated-questions meta:', e);
    return NextResponse.json({ error: '조회에 실패했습니다.' }, { status: 500 });
  }
}
