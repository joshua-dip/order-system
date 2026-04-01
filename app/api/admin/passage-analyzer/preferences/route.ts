import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/lib/mongodb';

const COL = 'passage_analyzer_preferences';

export async function GET(request: NextRequest) {
  const { error, payload } = await requireAdmin(request);
  if (error) return error;

  const teacherId = request.nextUrl.searchParams.get('teacherId')?.trim() || payload?.loginId || '';
  if (!teacherId) {
    return NextResponse.json({ success: false, message: 'teacherId가 필요합니다.' }, { status: 400 });
  }

  try {
    const db = await getDb('gomijoshua');
    const doc = await db.collection(COL).findOne({ teacherId });
    return NextResponse.json({ success: true, preferences: doc?.prefs || {} });
  } catch (e) {
    console.error('preferences GET:', e);
    return NextResponse.json({ success: false, preferences: {} }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const { error, payload } = await requireAdmin(request);
  if (error) return error;

  try {
    const body = await request.json();
    const teacherId =
      (typeof body.teacherId === 'string' && body.teacherId.trim()) || payload?.loginId || '';
    const prefs = body.prefs && typeof body.prefs === 'object' ? body.prefs : {};
    if (!teacherId) {
      return NextResponse.json({ success: false, message: 'teacherId가 필요합니다.' }, { status: 400 });
    }

    const db = await getDb('gomijoshua');
    await db.collection(COL).updateOne(
      { teacherId },
      {
        $set: { teacherId, prefs, updatedAt: new Date() },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true }
    );
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('preferences POST:', e);
    return NextResponse.json({ success: false, message: '저장 실패' }, { status: 500 });
  }
}
