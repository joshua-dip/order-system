import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { isMockExamTextbookKey } from '@/lib/mock-exam-key';
import { deriveSentencesFromPassageContent } from '@/lib/passage-analyzer-passages';
import {
  passageAnalysisFileNameForPassageId,
  type SvocSentenceData,
} from '@/lib/passage-analyzer-types';
import { listThreadsByPassage } from '@/lib/qna-store';

export const dynamic = 'force-dynamic';

/**
 * GET /api/qna/passages/[passageId]
 *
 * 응답:
 *  - passage: { id, textbook, sourceKey, sentences[], koreanSentences[] }
 *  - threads: QnaThreadRow[]   (status=hidden 제외)
 *  - svoc?: Record<number, SvocSentenceData>  (있고 1개 이상일 때만)
 *
 * 모의고사 키가 아니면 404 — Q&A 페이지는 모의고사 전용.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ passageId: string }> },
) {
  const { passageId } = await context.params;
  if (!passageId) {
    return NextResponse.json({ error: 'passageId 가 필요합니다.' }, { status: 400 });
  }

  let oid: ObjectId;
  try {
    oid = new ObjectId(passageId);
  } catch {
    return NextResponse.json({ error: '잘못된 passageId 입니다.' }, { status: 400 });
  }

  try {
    const db = await getDb('gomijoshua');
    const doc = (await db
      .collection('passages')
      .findOne(
        { _id: oid },
        {
          projection: {
            textbook: 1,
            source_key: 1,
            chapter: 1,
            number: 1,
            'content.original': 1,
            'content.translation': 1,
            'content.sentences_en': 1,
            'content.sentences_ko': 1,
          },
        },
      )) as
      | (Record<string, unknown> & {
          _id: ObjectId;
          textbook?: string;
          source_key?: string;
          content?: Record<string, unknown>;
        })
      | null;

    if (!doc) {
      return NextResponse.json({ error: '지문을 찾을 수 없습니다.' }, { status: 404 });
    }

    const textbook = String(doc.textbook ?? '').trim();
    if (!textbook || !isMockExamTextbookKey(textbook)) {
      return NextResponse.json(
        { error: '모의고사 지문만 Q&A 분석 페이지에 노출됩니다.' },
        { status: 404 },
      );
    }

    const { sentences, koreanSentences } = deriveSentencesFromPassageContent(doc.content);

    // 분석기에서 SVOC 데이터 가져오기 (있을 때만)
    let svoc: Record<number, SvocSentenceData> | undefined;
    try {
      const analysis = (await db
        .collection('passage_analyses')
        .findOne(
          { fileName: passageAnalysisFileNameForPassageId(String(doc._id)) },
          { projection: { 'passageStates.main.svocData': 1 } },
        )) as
        | { passageStates?: { main?: { svocData?: Record<string, SvocSentenceData> } } }
        | null;
      const raw = analysis?.passageStates?.main?.svocData;
      if (raw && typeof raw === 'object') {
        const entries = Object.entries(raw).filter(([, v]) => v && typeof v === 'object');
        if (entries.length > 0) {
          const normalized: Record<number, SvocSentenceData> = {};
          for (const [k, v] of entries) {
            const n = Number(k);
            if (Number.isFinite(n)) normalized[n] = v;
          }
          if (Object.keys(normalized).length > 0) svoc = normalized;
        }
      }
    } catch (err) {
      console.error('qna passage svoc lookup:', err);
      // svoc 조회 실패는 전체 응답을 막지 않는다.
    }

    const threads = await listThreadsByPassage(String(doc._id));

    return NextResponse.json({
      passage: {
        id: String(doc._id),
        textbook,
        sourceKey: typeof doc.source_key === 'string' ? doc.source_key : null,
        chapter: typeof doc.chapter === 'number' || typeof doc.chapter === 'string' ? doc.chapter : null,
        number: typeof doc.number === 'number' || typeof doc.number === 'string' ? doc.number : null,
        sentences,
        koreanSentences,
      },
      threads,
      ...(svoc ? { svoc } : {}),
    });
  } catch (e) {
    console.error('qna passage GET:', e);
    return NextResponse.json({ error: '지문 조회에 실패했습니다.' }, { status: 500 });
  }
}
