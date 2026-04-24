import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requireVip } from '@/lib/vip-auth';

export async function GET(request: NextRequest) {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const db = await getDb('gomijoshua');
    const [passageTextbooks, gqTextbooks] = await Promise.all([
      db.collection('passages').distinct('textbook'),
      db.collection('generated_questions').distinct('textbook'),
    ]);
    const tbSet = new Set<string>();
    for (const t of [...(passageTextbooks as string[]), ...(gqTextbooks as string[])]) {
      if (typeof t === 'string' && t.trim()) tbSet.add(t.trim());
    }
    const textbooks = [...tbSet].sort((a, b) => a.localeCompare(b, 'ko'));
    return NextResponse.json({ ok: true, textbooks });
  } catch (e) {
    console.error('vip textbooks:', e);
    return NextResponse.json({ ok: false, error: '교재 목록을 불러올 수 없습니다.' }, { status: 500 });
  }
}
