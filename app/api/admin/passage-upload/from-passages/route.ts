import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { readMergedConvertedData, writeMergedConvertedData } from '@/lib/converted-data-store';
import { buildMergedTextbookBranchFromPassages, type PassageRow } from '@/lib/build-converted-branch-from-passages';

/**
 * MongoDB passages(원문 관리) → 교재 병합 데이터로 동기화.
 * — 로컬: MongoDB + converted_data.json(가능 시)
 * — Vercel 등: MongoDB만 기록(파일시스템은 읽기 전용)
 */
export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const textbook = typeof body.textbook === 'string' ? body.textbook.trim() : '';
    if (!textbook) {
      return NextResponse.json({ error: '교재명(textbook)을 선택해 주세요.' }, { status: 400 });
    }

    const db = await getDb('gomijoshua');
    const docs = (await db
      .collection('passages')
      .find({ textbook })
      .project({ chapter: 1, number: 1, order: 1 })
      .sort({ chapter: 1, order: 1, number: 1 })
      .toArray()) as PassageRow[];

    if (docs.length === 0) {
      return NextResponse.json(
        { error: `MongoDB에 "${textbook}" 교재 원문이 없습니다. 원문 관리에서 먼저 등록해 주세요.` },
        { status: 404 }
      );
    }

    const built = buildMergedTextbookBranchFromPassages(textbook, docs);
    if (!built) {
      return NextResponse.json(
        { error: `번호가 있는 지문이 없어 "${textbook}" 트리를 만들 수 없습니다.` },
        { status: 400 },
      );
    }

    const existing = await readMergedConvertedData();
    existing[textbook] = built.branch;
    await writeMergedConvertedData(existing);

    return NextResponse.json({
      ok: true,
      textbook,
      lessonCount: built.lessonCount,
      passageCount: built.passageCount,
    });
  } catch (e) {
    console.error('passage-upload/from-passages:', e);
    return NextResponse.json({ error: '동기화 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
