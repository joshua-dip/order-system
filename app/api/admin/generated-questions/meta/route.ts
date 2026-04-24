import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const db = await getDb('gomijoshua');
    const col = db.collection('generated_questions');
    const narrCol = db.collection('narrative_questions');
    const passagesCol = db.collection('passages');
    const linksCol = db.collection('textbook_links');
    const [gqTextbooks, passageTextbooks, types, statuses, narrTextbooks, narrSubtypes, examBasedDocs] = await Promise.all([
      col.distinct('textbook'),
      passagesCol.distinct('textbook'),
      col.distinct('type'),
      col.distinct('status'),
      narrCol.distinct('textbook'),
      narrCol.distinct('narrative_subtype'),
      linksCol.find({ isExamBased: true }).project({ _id: 0, textbookKey: 1, originalSourceTextbook: 1 }).toArray(),
    ]);
    const tbSet = new Set<string>();
    for (const t of [...(gqTextbooks as string[]), ...(passageTextbooks as string[]), ...(narrTextbooks as string[])]) {
      if (typeof t === 'string' && t.trim()) tbSet.add(t.trim());
    }
    const textbooks = [...tbSet].sort((a, b) => a.localeCompare(b, 'ko'));
    const typeSet = new Set<string>();
    for (const t of types as string[]) {
      if (typeof t === 'string' && t.trim()) typeSet.add(t.trim());
    }
    for (const t of narrSubtypes as string[]) {
      if (typeof t === 'string' && t.trim()) typeSet.add(t.trim());
    }
    const mergedTypes = [...typeSet].sort((a, b) => a.localeCompare(b, 'ko'));

    /** 기출기반 교재 집합 + 원문출처 맵 */
    const examBasedTextbooks: string[] = [];
    const originalSourceByTextbook: Record<string, string> = {};
    for (const d of examBasedDocs) {
      const key = String(d.textbookKey ?? '').trim();
      if (!key) continue;
      examBasedTextbooks.push(key);
      if (d.originalSourceTextbook && typeof d.originalSourceTextbook === 'string') {
        originalSourceByTextbook[key] = d.originalSourceTextbook.trim();
      }
    }

    return NextResponse.json({
      textbooks,
      types: mergedTypes,
      statuses: (statuses as string[]).filter(Boolean).sort((a, b) => a.localeCompare(b, 'ko')),
      examBasedTextbooks,
      originalSourceByTextbook,
    });
  } catch (e) {
    console.error('generated-questions meta:', e);
    return NextResponse.json({ error: '조회에 실패했습니다.' }, { status: 500 });
  }
}
