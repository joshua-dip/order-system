import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { TEXTBOOK_LINKS_COLLECTION } from '@/lib/textbook-links-db';

export const dynamic = 'force-dynamic';

/**
 * 기출기반 교재 여부 + 원문출처 교재명 조회.
 * Response: {
 *   examBased: { "교재명": true, ... },
 *   originalSourceByTextbook: { "교재명": "원문출처 교재명", ... }
 * }
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const db = await getDb('gomijoshua');
    const docs = await db
      .collection(TEXTBOOK_LINKS_COLLECTION)
      .find({ isExamBased: true })
      .project({ _id: 0, textbookKey: 1, isExamBased: 1, originalSourceTextbook: 1 })
      .toArray();

    const examBased: Record<string, boolean> = {};
    const originalSourceByTextbook: Record<string, string> = {};
    for (const d of docs) {
      if (typeof d.textbookKey === 'string' && d.textbookKey) {
        examBased[d.textbookKey] = true;
        if (typeof d.originalSourceTextbook === 'string' && d.originalSourceTextbook.trim()) {
          originalSourceByTextbook[d.textbookKey] = d.originalSourceTextbook.trim();
        }
      }
    }
    return NextResponse.json({ examBased, originalSourceByTextbook });
  } catch (e) {
    console.error('exam-based-by-textbook GET:', e);
    return NextResponse.json({ error: '조회 실패' }, { status: 500 });
  }
}

/**
 * 기출기반 여부 저장 또는 원문출처 교재명 업데이트.
 * Body (기출기반 ON/OFF): { textbookKey: string, isExamBased: boolean }
 * Body (원문출처 변경):    { textbookKey: string, originalSourceTextbook: string }
 */
export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const body = await request.json();
    const textbookKey = typeof body?.textbookKey === 'string' ? body.textbookKey.trim() : '';

    if (!textbookKey) {
      return NextResponse.json({ error: 'textbookKey는 필수입니다.' }, { status: 400 });
    }

    const db = await getDb('gomijoshua');
    const col = db.collection(TEXTBOOK_LINKS_COLLECTION);
    await col.createIndex({ textbookKey: 1 }, { unique: true }).catch(() => {});

    // 원문출처 교재명만 업데이트하는 경우
    if ('originalSourceTextbook' in body) {
      const originalSourceTextbook =
        typeof body.originalSourceTextbook === 'string'
          ? body.originalSourceTextbook.trim()
          : '';
      if (originalSourceTextbook) {
        await col.updateOne(
          { textbookKey },
          { $set: { textbookKey, originalSourceTextbook, updatedAt: new Date() } },
          { upsert: true }
        );
      } else {
        await col.updateOne(
          { textbookKey },
          { $unset: { originalSourceTextbook: '' }, $set: { updatedAt: new Date() } }
        );
      }
      return NextResponse.json({ ok: true, textbookKey, originalSourceTextbook });
    }

    // 기출기반 ON/OFF
    const isExamBased = body?.isExamBased === true;
    if (isExamBased) {
      await col.updateOne(
        { textbookKey },
        { $set: { textbookKey, isExamBased: true, updatedAt: new Date() } },
        { upsert: true }
      );
    } else {
      await col.updateOne(
        { textbookKey },
        { $unset: { isExamBased: '', originalSourceTextbook: '' }, $set: { updatedAt: new Date() } }
      );
    }

    return NextResponse.json({ ok: true, textbookKey, isExamBased });
  } catch (e) {
    console.error('exam-based-by-textbook POST:', e);
    return NextResponse.json({ error: '저장 실패' }, { status: 500 });
  }
}
