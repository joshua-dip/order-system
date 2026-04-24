import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/lib/mongodb';
import { passageAnalysisFileNameForPassageId } from '@/lib/passage-analyzer-types';
import { passageAnalyzerProgressFromMain } from '@/lib/passage-analyzer-progress-score';

const COL = 'passage_analyses';
const MAX_IDS = 500;

export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const body = await request.json();
    const raw = body.passageIds;
    const ids = Array.isArray(raw)
      ? raw.map((x) => String(x ?? '').trim()).filter((id) => ObjectId.isValid(id))
      : [];
    const unique = [...new Set(ids.map((id) => id.toLowerCase()))].slice(0, MAX_IDS);

    if (unique.length === 0) {
      return NextResponse.json({ success: true, progress: {} as Record<string, number> });
    }

    const db = await getDb('gomijoshua');
    const fileNames = unique.map((id) => passageAnalysisFileNameForPassageId(id));
    // passageStates.main 전체를 가져오면 vocabularyList 등 대용량 필드까지 딸려와 느림.
    // 진행률 계산에 필요한 필드만 좁혀서 projection — 배열은 $slice:1(존재 여부 확인용).
    const docs = await db
      .collection(COL)
      .find({ fileName: { $in: fileNames } })
      .project({
        fileName: 1,
        'passageStates.main.manualStepStatus': 1,
        'passageStates.main.analysisResults': 1,
        'passageStates.main.topicHighlightedSentences': { $slice: 1 },
        'passageStates.main.essayHighlightedSentences': { $slice: 1 },
        'passageStates.main.grammarSelectedWords': { $slice: 1 },
        'passageStates.main.grammarSelectedRanges': { $slice: 1 },
        'passageStates.main.contextSelectedWords': { $slice: 1 },
        'passageStates.main.grammarTags': { $slice: 1 },
        'passageStates.main.vocabularyList': { $slice: 1 },
        'passageStates.main.sentenceBreaks': 1,
        'passageStates.main.svocData': 1,
        'passageStates.main.syntaxPhrases': 1,
      })
      .toArray();

    const progress: Record<string, number> = {};
    for (const doc of docs) {
      const fn = String((doc as { fileName?: string }).fileName || '');
      const m = fn.match(/^passage:([a-f0-9]{24})$/i);
      if (!m) continue;
      const pid = m[1].toLowerCase();
      const main = (doc as { passageStates?: { main?: Record<string, unknown> } }).passageStates?.main;
      progress[pid] = passageAnalyzerProgressFromMain(main).percent;
    }

    return NextResponse.json({ success: true, progress });
  } catch (e) {
    console.error('list-progress:', e);
    return NextResponse.json({ error: '진행률 조회 실패' }, { status: 500 });
  }
}
