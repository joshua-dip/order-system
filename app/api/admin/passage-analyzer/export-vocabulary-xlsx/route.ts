import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/lib/mongodb';
import {
  passageAnalysisFileNameForPassageId,
  type PassageStateStored,
  type VocabularyEntry,
} from '@/lib/passage-analyzer-types';
import {
  buildTextbookVocabularyAoA,
  type PassageListRowForExport,
} from '@/lib/passage-analyzer-vocabulary-export';

const PASSAGES_LIMIT = 2500;

export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const body = await request.json();
    const textbook = typeof body.textbook === 'string' ? body.textbook.trim() : '';
    if (!textbook) {
      return NextResponse.json({ error: '교재명(textbook)이 필요합니다.' }, { status: 400 });
    }

    const db = await getDb('gomijoshua');
    const passages = (await db
      .collection('passages')
      .find({ textbook })
      .project({ _id: 1, textbook: 1, chapter: 1, number: 1, source_key: 1, order: 1 })
      .sort({ chapter: 1, order: 1, number: 1 })
      .limit(PASSAGES_LIMIT)
      .toArray()) as PassageListRowForExport[];

    if (passages.length === 0) {
      return NextResponse.json({ error: '해당 교재명의 지문이 없습니다.' }, { status: 404 });
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
      return NextResponse.json(
        {
          error:
            'MongoDB에 저장된 단어장(passage_analyses)이 있는 지문이 없습니다. 지문 분석 작업대에서 단어장을 저장한 뒤 다시 시도하세요.',
        },
        { status: 404 }
      );
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    XLSX.utils.book_append_sheet(wb, ws, '단어장_교재전체');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const b64 = Buffer.from(textbook, 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
    const asciiName = `vocab-textbook-${b64.slice(0, 28)}.xlsx`;

    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(`단어장_${textbook}_전체.xlsx`)}`,
      },
    });
  } catch (e) {
    console.error('export-vocabulary-xlsx:', e);
    return NextResponse.json({ error: '엑셀 생성에 실패했습니다.' }, { status: 500 });
  }
}
