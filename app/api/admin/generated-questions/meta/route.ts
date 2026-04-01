import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const db = await getDb('gomijoshua');
    const col = db.collection('generated_questions');
    const passagesCol = db.collection('passages');
    const [gqTextbooks, passageTextbooks, types, statuses] = await Promise.all([
      col.distinct('textbook'),
      passagesCol.distinct('textbook'),
      col.distinct('type'),
      col.distinct('status'),
    ]);
    const tbSet = new Set<string>();
    for (const t of [...(gqTextbooks as string[]), ...(passageTextbooks as string[])]) {
      if (typeof t === 'string' && t.trim()) tbSet.add(t.trim());
    }
    const textbooks = [...tbSet].sort((a, b) => a.localeCompare(b, 'ko'));
    return NextResponse.json({
      textbooks,
      types: (types as string[]).filter(Boolean).sort((a, b) => a.localeCompare(b, 'ko')),
      statuses: (statuses as string[]).filter(Boolean).sort((a, b) => a.localeCompare(b, 'ko')),
    });
  } catch (e) {
    console.error('generated-questions meta:', e);
    return NextResponse.json({ error: '조회에 실패했습니다.' }, { status: 500 });
  }
}
