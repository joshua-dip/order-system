import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/lib/mongodb';

const COL = 'passage_analyses';

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const fileName = request.nextUrl.searchParams.get('fileName')?.trim() || '';
  if (!fileName) {
    return NextResponse.json({ error: 'fileName이 필요합니다.' }, { status: 400 });
  }

  try {
    const db = await getDb('gomijoshua');
    const doc = await db.collection(COL).findOne(
      { fileName: decodeURIComponent(fileName) },
      { projection: { passageStates: 1, version: 1 } }
    );
    const states = (doc as { passageStates?: Record<string, unknown> })?.passageStates || {};
    const keys = Object.keys(states);
    const progress: Record<string, { done: number; total: number }> = {};
    for (const k of keys) {
      progress[k] = { done: 0, total: 1 };
    }
    return NextResponse.json({ success: true, progress, keys });
  } catch (e) {
    console.error('file-progress:', e);
    return NextResponse.json({ success: true, progress: {} });
  }
}
