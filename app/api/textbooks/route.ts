import { NextRequest, NextResponse } from 'next/server';
import { readMergedConvertedData } from '@/lib/converted-data-store';
import { enrichTextbooksForVocabularyList } from '@/lib/vocabulary-textbooks-enrich';

/**
 * 교재 병합 데이터를 API로 제공합니다.
 * — 관리자가 반영한 내용은 MongoDB `converted_textbook_json` 우선,
 * — 없으면 저장소의 converted_data.json (기본 번들).
 *
 * GET ?vocabularyEnrich=1
 * — 단어장용: mock-exams.json + passages 모의고사 교재명을 합쳐,
 *   병합 JSON에 강·번호 트리가 없는 모의고사만 passages 기준으로 메모리에서 채움(저장 안 함).
 */
export async function GET(request: NextRequest) {
  try {
    let data = await readMergedConvertedData();
    if (request.nextUrl.searchParams.get('vocabularyEnrich') === '1') {
      data = await enrichTextbooksForVocabularyList(data);
    }
    return NextResponse.json(data);
  } catch (err) {
    console.error('교재 데이터 로드 실패:', err);
    return NextResponse.json(
      { error: '교재 데이터를 불러올 수 없습니다.' },
      { status: 503 }
    );
  }
}
