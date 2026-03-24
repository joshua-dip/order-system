import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { readMergedConvertedData, writeMergedConvertedData } from '@/lib/converted-data-store';

type PassageRow = { chapter?: unknown; number?: unknown; order?: unknown };

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

    const byChapter = new Map<string, Map<string, { order: number }>>();
    for (const p of docs) {
      const chRaw = String(p.chapter ?? '').trim();
      const ch = chRaw || '(강 미지정)';
      const num = String(p.number ?? '').trim();
      if (!num) continue;
      const ord =
        typeof p.order === 'number' && Number.isFinite(p.order) ? p.order : 1_000_000;
      if (!byChapter.has(ch)) byChapter.set(ch, new Map());
      const inner = byChapter.get(ch)!;
      const prev = inner.get(num);
      if (!prev || ord < prev.order) inner.set(num, { order: ord });
    }

    const lessonKeys = [...byChapter.keys()].sort((a, b) => a.localeCompare(b, 'ko'));
    const 부교재Inner: Record<string, Record<string, { 번호: string }[]>> = {};
    부교재Inner[textbook] = {};

    for (const lesson of lessonKeys) {
      const nums = byChapter.get(lesson)!;
      const entries = [...nums.entries()].sort((a, b) => {
        const o = a[1].order - b[1].order;
        if (o !== 0) return o;
        return a[0].localeCompare(b[0], 'ko');
      });
      부교재Inner[textbook][lesson] = entries.map(([n]) => ({ 번호: n }));
    }

    const branch = {
      Sheet1: {
        부교재: 부교재Inner,
      },
    };

    const existing = await readMergedConvertedData();
    existing[textbook] = branch;
    await writeMergedConvertedData(existing);

    const lessonCount = lessonKeys.length;
    const passageCount = docs.filter((p) => String(p.number ?? '').trim()).length;

    return NextResponse.json({
      ok: true,
      textbook,
      lessonCount,
      passageCount,
    });
  } catch (e) {
    console.error('passage-upload/from-passages:', e);
    return NextResponse.json({ error: '동기화 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
