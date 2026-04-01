import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/lib/mongodb';

const COL = 'passage_analyses';

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const db = await getDb('gomijoshua');
    const analyses = await db.collection(COL).find({}).limit(500).toArray();
    const allGrammarTags: Record<string, unknown>[] = [];
    const allPassageStates: Record<string, unknown> = {};

    for (const analysis of analyses) {
      const fileName = String((analysis as { fileName?: string }).fileName || '');
      const passageStates = (analysis as { passageStates?: Record<string, Record<string, unknown>> })
        .passageStates;
      if (!passageStates) continue;
      Object.entries(passageStates).forEach(([key, state]) => {
        const sourceKey = `${fileName}:${key}`;
        const tags = (state as { grammarTags?: unknown[] }).grammarTags;
        if (tags && tags.length > 0) {
          tags.forEach((tag) => {
            allGrammarTags.push({
              ...(tag as object),
              source: sourceKey,
              fileName: fileName.replace(/^auto-save-/, '').replace(/\.json$/i, ''),
            });
          });
        }
        allPassageStates[sourceKey] = { ...state, fileName };
      });
    }

    return NextResponse.json({
      grammarTags: allGrammarTags,
      passageStates: allPassageStates,
      totalFiles: analyses.length,
    });
  } catch (e) {
    console.error('load-all-grammar-tags:', e);
    return NextResponse.json(
      { error: '불러오기 실패', grammarTags: [], passageStates: {} },
      { status: 500 }
    );
  }
}
