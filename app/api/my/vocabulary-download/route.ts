import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import * as XLSX from 'xlsx';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { isAnnualMemberActive } from '@/lib/annual-member';
import {
  passageAnalysisFileNameForPassageId,
  type PassageStateStored,
  type VocabularyEntry,
} from '@/lib/passage-analyzer-types';
import {
  buildTextbookVocabularyAoA,
  type PassageListRowForExport,
} from '@/lib/passage-analyzer-vocabulary-export';

export async function POST(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: '인증이 만료되었습니다.' }, { status: 401 });

  const db = await getDb('gomijoshua');
  const user = await db.collection('users').findOne(
    { _id: new ObjectId(payload.sub) },
    { projection: { annualMemberSince: 1 } },
  );
  if (!user || !isAnnualMemberActive((user as { annualMemberSince?: Date }).annualMemberSince ?? null)) {
    return NextResponse.json({ error: '연회원만 이용할 수 있습니다.' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const textbook = typeof body.textbook === 'string' ? body.textbook.trim() : '';
    const selectedLessons: string[] = Array.isArray(body.selectedLessons) ? body.selectedLessons : [];

    if (!textbook) return NextResponse.json({ error: '교재명이 필요합니다.' }, { status: 400 });

    let passageFilter: Record<string, unknown>;
    if (selectedLessons.length > 0) {
      const orClauses = selectedLessons.map((l) => {
        const parts = l.split(' ');
        return { textbook, chapter: parts[0], number: parts.slice(1).join(' ') };
      });
      passageFilter = { $or: orClauses };
    } else {
      passageFilter = { textbook };
    }

    const passages = (await db
      .collection('passages')
      .find(passageFilter)
      .project({ _id: 1, textbook: 1, chapter: 1, number: 1, source_key: 1, order: 1 })
      .sort({ chapter: 1, order: 1, number: 1 })
      .limit(500)
      .toArray()) as PassageListRowForExport[];

    if (passages.length === 0) {
      return NextResponse.json({ error: '해당 조건의 지문이 없습니다.' }, { status: 404 });
    }

    const fileNames = passages.map((p) => passageAnalysisFileNameForPassageId(String(p._id)));
    const analyses = await db
      .collection('passage_analyses')
      .find({ fileName: { $in: fileNames } })
      .project({ fileName: 1, passageStates: 1 })
      .toArray();

    const vocabByFile = new Map<string, VocabularyEntry[]>();
    for (const a of analyses) {
      const fn = String((a as { fileName?: string }).fileName || '');
      const main = (a as { passageStates?: { main?: PassageStateStored } }).passageStates?.main;
      const list = Array.isArray(main?.vocabularyList) ? main!.vocabularyList! : [];
      if (list.length > 0) vocabByFile.set(fn, list);
    }

    const aoa = buildTextbookVocabularyAoA(passages, vocabByFile);
    if (aoa.length <= 1) {
      return NextResponse.json({ error: '단어장 데이터가 아직 준비되지 않았습니다.' }, { status: 404 });
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    XLSX.utils.book_append_sheet(wb, ws, '단어장');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const fileName = `단어장_${textbook}${selectedLessons.length > 0 ? `_${selectedLessons.length}지문` : '_전체'}.xlsx`;

    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      },
    });
  } catch (e) {
    console.error('vocabulary-download:', e);
    return NextResponse.json({ error: '다운로드에 실패했습니다.' }, { status: 500 });
  }
}
