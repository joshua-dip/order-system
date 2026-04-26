import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';

/**
 * DELETE /api/admin/essay-generator/delete-folder
 * body: { folder: string }
 *
 * 해당 폴더의 모든 essay_exams 문서를 삭제
 */
export async function DELETE(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  let body: { folder?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 });
  }

  const folder = body.folder?.trim();
  if (!folder) {
    return NextResponse.json({ error: 'folder 이름이 필요합니다.' }, { status: 400 });
  }

  try {
    const db = await getDb('gomijoshua');
    const result = await db.collection('essay_exams').deleteMany({ folder });
    return NextResponse.json({ ok: true, deleted: result.deletedCount });
  } catch (err) {
    console.error('[delete-folder]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '폴더 삭제 실패' },
      { status: 500 },
    );
  }
}
