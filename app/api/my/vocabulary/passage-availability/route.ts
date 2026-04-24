import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import {
  passageAnalysisFileNameForPassageId,
  parsePassageIdFromFileName,
  type PassageStateStored,
} from '@/lib/passage-analyzer-types';
import { lessonLabelFromPassageRow } from '@/lib/vocabulary-lesson-label';

/**
 * GET ?textbook=…
 * 해당 교재 지문 중, passage_analyses.main.vocabularyList 가 1개 이상인 지문의
 * lesson_label 목록 (단어장 구매 UI에서 선택 가능 여부 판별)
 */
export async function GET(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: '인증이 만료되었습니다.' }, { status: 401 });

  const textbook = request.nextUrl.searchParams.get('textbook')?.trim() ?? '';
  if (!textbook || textbook.length > 300) {
    return NextResponse.json({ error: 'textbook 파라미터가 필요합니다.' }, { status: 400 });
  }

  try {
    const db = await getDb('gomijoshua');
    type PRow = { _id: { toHexString(): string }; chapter?: string; number?: string };
    const passages = (await db
      .collection('passages')
      .find({ textbook })
      .project({ _id: 1, chapter: 1, number: 1 })
      .toArray()) as PRow[];

    if (passages.length === 0) {
      return NextResponse.json({ lessonLabelsWithVocabulary: [] as string[] });
    }

    const fileNames = passages.map((p) => passageAnalysisFileNameForPassageId(p._id.toHexString()));
    const analyses = await db
      .collection('passage_analyses')
      .find({ fileName: { $in: fileNames } })
      .project({ fileName: 1, passageStates: 1 })
      .toArray();

    const withVocab = new Set<string>();
    for (const a of analyses) {
      const main = (a as { passageStates?: { main?: PassageStateStored } }).passageStates?.main;
      const list = Array.isArray(main?.vocabularyList) ? main!.vocabularyList! : [];
      if (list.length === 0) continue;

      const fn = String((a as { fileName?: string }).fileName || '');
      const pid = parsePassageIdFromFileName(fn);
      if (!pid) continue;
      const p = passages.find((row) => row._id.toHexString() === pid);
      if (!p) continue;
      const label = lessonLabelFromPassageRow(p);
      if (label) withVocab.add(label);
    }

    return NextResponse.json({
      lessonLabelsWithVocabulary: [...withVocab].sort((a, b) => a.localeCompare(b, 'ko')),
    });
  } catch (e) {
    console.error('vocabulary/passage-availability:', e);
    return NextResponse.json({ error: '조회에 실패했습니다.' }, { status: 500 });
  }
}
