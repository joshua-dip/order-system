import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { TEXTBOOK_LINKS_COLLECTION } from '@/lib/textbook-links-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 한 교재(textbook)에 속한 모든 원문(passages)을 한 번에 삭제합니다.
 * 교재 전용 메타데이터(textbook_links · 폴더 배정)도 함께 정리해 목록에서 사라지게 합니다.
 *
 * 주문(orders)·생성문제(generated_questions 등)·회원 허용교재 목록·settings 배열은
 * 건드리지 않습니다(과거 이력 보존). 교재명을 바꾸려면 scripts/rename-textbook-key.ts 사용.
 *
 * DELETE /api/admin/passages/by-textbook?textbook=<교재명>
 */
export async function DELETE(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const textbook = (request.nextUrl.searchParams.get('textbook') ?? '').trim();
  if (!textbook) {
    return NextResponse.json({ error: '교재명(textbook)이 필요합니다.' }, { status: 400 });
  }

  try {
    const db = await getDb('gomijoshua');

    const passagesResult = await db.collection('passages').deleteMany({ textbook });
    const linksResult = await db
      .collection(TEXTBOOK_LINKS_COLLECTION)
      .deleteMany({ textbookKey: textbook });
    const assignResult = await db
      .collection('textbook_link_folder_assignments')
      .deleteMany({ textbookKey: textbook });

    return NextResponse.json({
      ok: true,
      textbook,
      deletedPassages: passagesResult.deletedCount,
      deletedLinks: linksResult.deletedCount,
      deletedFolderAssignments: assignResult.deletedCount,
    });
  } catch (e) {
    console.error('passages by-textbook DELETE:', e);
    return NextResponse.json({ error: '교재 전체 삭제에 실패했습니다.' }, { status: 500 });
  }
}
