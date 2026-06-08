import { NextRequest, NextResponse } from 'next/server';
import type { VocabularyEntry } from '@/lib/passage-analyzer-types';
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

function parseEntries(raw: unknown): VocabularyEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 500) as VocabularyEntry[];
}

/**
 * POST /api/public/vocabulary/download
 * 비회원 체험 단어장 다운로드 — vocabulary_list 를 body 로 받음 (인증 없음)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const format: Format = VALID_FORMATS.includes(body?.format) ? (body.format as Format) : 'xlsx';
    const cefrLevels: string[] = Array.isArray(body?.cefrLevels) ? body.cefrLevels : [];
    const shuffle: boolean = body?.shuffle === true;
    const direction: 'word-to-meaning' | 'meaning-to-word' =
      body?.direction === 'meaning-to-word' ? 'meaning-to-word' : 'word-to-meaning';
    const layoutColumns: 1 | 2 = body?.layoutColumns === 2 ? 2 : 1;
    const title =
      typeof body?.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 120) : '단어장';
    const entries = parseEntries(body?.vocabulary_list);
    if (entries.length === 0) {
      return NextResponse.json({ error: '다운로드할 단어가 없습니다.' }, { status: 400 });
    }

    const cols: VocabColumns = {
      wordType: body?.columns?.wordType !== false,
      pos: body?.columns?.pos !== false,
      cefr: body?.columns?.cefr !== false,
      meaning: body?.columns?.meaning !== false,
      synonym: body?.columns?.synonym ?? DEFAULT_COLUMNS.synonym,
      antonym: body?.columns?.antonym ?? DEFAULT_COLUMNS.antonym,
      opposite: body?.columns?.opposite ?? false,
    };

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

    const xlsxBuf = buildVocabXlsx(entries, title, cefrLevels, cols);
    const fileName = `단어장_${safeName}.xlsx`;
    return new NextResponse(new Uint8Array(xlsxBuf), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      },
    });
  } catch (e) {
    console.error('public/vocabulary/download:', e);
    return NextResponse.json({ error: '다운로드에 실패했습니다.' }, { status: 500 });
  }
}
