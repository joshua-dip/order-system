import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { getMyVocabulary } from '@/lib/vocabulary-library-store';
import {
  buildVocabXlsx,
  buildVocabPdf,
  buildTestXlsx,
  buildTestPdf,
  buildFirstLetterPdf,
  buildHiddenMeaningPdf,
  buildFlashcardPdf,
  buildAnkiCsv,
  type VocabColumns,
  DEFAULT_COLUMNS,
} from '@/lib/vocabulary-export';

type Params = { params: Promise<{ id: string }> };

const VALID_FORMATS = [
  'xlsx',
  'pdf',
  'test-xlsx',
  'test-pdf',
  'first-letter-pdf',
  'hidden-meaning-pdf',
  'flashcard-pdf',
  'anki-csv',
] as const;
type Format = (typeof VALID_FORMATS)[number];

export async function POST(request: NextRequest, { params }: Params) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: '인증이 만료되었습니다.' }, { status: 401 });

  const { id } = await params;

  try {
    const doc = await getMyVocabulary(id, new ObjectId(payload.sub));
    if (!doc) return NextResponse.json({ error: '단어장을 찾을 수 없습니다.' }, { status: 404 });

    const body = await request.json();

    const format: Format = VALID_FORMATS.includes(body?.format) ? (body.format as Format) : 'xlsx';
    const cefrLevels: string[] = Array.isArray(body?.cefrLevels) ? body.cefrLevels : [];
    const shuffle: boolean = body?.shuffle === true;
    const direction: 'word-to-meaning' | 'meaning-to-word' =
      body?.direction === 'meaning-to-word' ? 'meaning-to-word' : 'word-to-meaning';
    const layoutColumns: 1 | 2 = body?.layoutColumns === 2 ? 2 : 1;

    const cols: VocabColumns = {
      wordType: body?.columns?.wordType !== false,
      pos: body?.columns?.pos !== false,
      cefr: body?.columns?.cefr !== false,
      meaning: body?.columns?.meaning !== false,
      synonym: body?.columns?.synonym ?? DEFAULT_COLUMNS.synonym,
      antonym: body?.columns?.antonym ?? DEFAULT_COLUMNS.antonym,
      opposite: body?.columns?.opposite ?? false,
    };

    const title = doc.display_label || doc.textbook;
    const entries = doc.vocabulary_list;
    const safeName = title.replace(/[/\\?%*:|"<>]/g, '-');

    if (format === 'anki-csv') {
      const buf = buildAnkiCsv(entries, cefrLevels);
      const fileName = `단어장_${safeName}_Anki.txt`;
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        },
      });
    }

    if (format === 'test-xlsx') {
      const buf = buildTestXlsx(entries, cefrLevels, direction, shuffle);
      const fileName = `단어시험지_${safeName}.xlsx`;
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        },
      });
    }

    if (format === 'test-pdf') {
      const buf = await buildTestPdf(entries, title, cefrLevels, direction, layoutColumns, shuffle);
      const fileName = `단어시험지_${safeName}.pdf`;
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        },
      });
    }

    if (format === 'first-letter-pdf') {
      const buf = await buildFirstLetterPdf(entries, title, cefrLevels, shuffle);
      const fileName = `첫글자시험지_${safeName}.pdf`;
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        },
      });
    }

    if (format === 'hidden-meaning-pdf') {
      const buf = await buildHiddenMeaningPdf(entries, title, cefrLevels, shuffle);
      const fileName = `뜻가리기_${safeName}.pdf`;
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        },
      });
    }

    if (format === 'flashcard-pdf') {
      const buf = await buildFlashcardPdf(entries, title, cefrLevels);
      const fileName = `플래시카드_${safeName}.pdf`;
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        },
      });
    }

    if (format === 'pdf') {
      const buf = await buildVocabPdf(entries, title, cefrLevels, cols);
      const fileName = `단어장_${safeName}.pdf`;
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        },
      });
    }

    // xlsx (default)
    const buf = buildVocabXlsx(entries, title, cefrLevels, cols);
    const fileName = `단어장_${safeName}.xlsx`;
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      },
    });
  } catch (e) {
    console.error('vocabulary/[id]/download:', e);
    return NextResponse.json({ error: '다운로드에 실패했습니다.' }, { status: 500 });
  }
}
