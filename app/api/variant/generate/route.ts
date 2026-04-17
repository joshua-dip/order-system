import { NextRequest, NextResponse } from 'next/server';
import { generateVariantDraftQuestionDataWithClaude } from '@/lib/admin-variant-draft-claude';
import { BOOK_VARIANT_QUESTION_TYPES } from '@/lib/book-variant-types';

const TYPE_SET = new Set<string>(BOOK_VARIANT_QUESTION_TYPES);

/**
 * 비회원 공개 변형문제 생성 API.
 * 로그인 불필요. BYOK 헤더(x-anthropic-api-key)만 필수.
 * DB 저장 없이 question_data만 반환.
 */
export async function POST(request: NextRequest) {
  const apiKeyHeader = request.headers.get('x-anthropic-api-key')?.trim();
  if (!apiKeyHeader) {
    return NextResponse.json(
      { error: 'Anthropic API 키를 헤더 x-anthropic-api-key 로 보내 주세요.' },
      { status: 400 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON 본문이 필요합니다.' }, { status: 400 });
  }

  const paragraph = typeof body.paragraph === 'string' ? body.paragraph.trim() : '';
  const type = typeof body.type === 'string' ? body.type.trim() : '';
  const userHint = typeof body.userHint === 'string' ? body.userHint.trim() : '';
  const typePrompt = typeof body.typePrompt === 'string' ? body.typePrompt.trim() : '';
  const difficulty = typeof body.difficulty === 'string' ? body.difficulty.trim() : '중';

  if (!paragraph || paragraph.length < 10) {
    return NextResponse.json({ error: '지문을 충분히 입력해 주세요.' }, { status: 400 });
  }
  if (!type || !TYPE_SET.has(type)) {
    return NextResponse.json({ error: '유효한 문제 유형이 필요합니다.' }, { status: 400 });
  }

  try {
    const ai = await generateVariantDraftQuestionDataWithClaude({
      paragraph,
      type,
      nextNum: 1,
      userHint,
      typePrompt,
      difficulty,
      anthropicApiKey: apiKeyHeader,
    });

    if (!ai.ok) {
      return NextResponse.json({ error: ai.error }, { status: 422 });
    }

    return NextResponse.json({
      ok: true,
      type,
      question_data: ai.question_data,
    });
  } catch (e) {
    console.error('variant/generate (public):', e);
    return NextResponse.json({ error: '생성 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
