import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { loadExamScopeCatalog } from '@/lib/exam-scope-catalog';

export const dynamic = 'force-dynamic';

/** 시험범위 만들기 — 폴더별 교재 목록. 부교재는 회원 허용분(allowedTextbooksVariant)만, 관리자는 전부. */
export async function GET(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const payload = token ? await verifyToken(token) : null;
  if (!payload) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  try {
    const db = await getDb('gomijoshua');
    let allowed: string[] | null = null;
    if (payload.role !== 'admin') {
      const u = ObjectId.isValid(payload.sub)
        ? await db.collection('users').findOne({ _id: new ObjectId(payload.sub) }, { projection: { allowedTextbooksVariant: 1 } })
        : null;
      allowed = Array.isArray(u?.allowedTextbooksVariant) ? u.allowedTextbooksVariant.map(String) : [];
    }
    return NextResponse.json({ folders: await loadExamScopeCatalog(db, allowed) });
  } catch (e) {
    console.error('exam-scope catalog GET:', e);
    return NextResponse.json({ error: '교재 목록을 불러오지 못했습니다.' }, { status: 500 });
  }
}
