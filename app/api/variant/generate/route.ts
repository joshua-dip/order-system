import { NextRequest, NextResponse } from 'next/server';
import { generateVariantDraftQuestionDataWithClaude } from '@/lib/admin-variant-draft-claude';
import { BOOK_VARIANT_QUESTION_TYPES } from '@/lib/book-variant-types';
import { detectPassageSource } from '@/lib/passage-source-detect';
import {
  GUEST_PARAGRAPH_MAX_LEN,
  ensureGuestGeneratedIndexes,
  hashIp,
  saveGuestGeneratedQuestion,
} from '@/lib/guest-generated-questions-store';
import { isGuestRequestBlocked } from '@/lib/guest-variant-blocklist';

const TYPE_SET = new Set<string>(BOOK_VARIANT_QUESTION_TYPES);

/**
 * 비회원 공개 변형문제 생성 API.
 * 로그인 불필요. BYOK 헤더(x-anthropic-api-key)만 필수.
 * 사용자 응답에는 question_data만 반환하지만, 서버는 출처 탐지 후
 * guest_generated_questions 컬렉션에 fire-and-forget 로 로그를 남긴다.
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
  if (paragraph.length > GUEST_PARAGRAPH_MAX_LEN) {
    return NextResponse.json(
      { error: `지문이 너무 깁니다. ${GUEST_PARAGRAPH_MAX_LEN}자 이하로 입력해 주세요.` },
      { status: 413 },
    );
  }
  if (!type || !TYPE_SET.has(type)) {
    return NextResponse.json({ error: '유효한 문제 유형이 필요합니다.' }, { status: 400 });
  }

  const ipHeader =
    request.headers.get('x-forwarded-for') ||
    request.headers.get('x-real-ip') ||
    '';
  const userAgent = request.headers.get('user-agent') || '';
  const apiKeyHint = apiKeyHeader.slice(0, 12);
  const ipHash = hashIp(ipHeader);

  try {
    const blocked = await isGuestRequestBlocked({ ipHash, apiKeyHint });
    if (blocked.blocked) {
      return NextResponse.json(
        { error: '이 경로에서 요청이 차단되었습니다.' },
        { status: 429 },
      );
    }
  } catch {
    // 차단 조회 실패는 무시하고 정상 진행
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

    // Vercel Lambda는 return 즉시 함수가 종료되므로 응답 전에 await해서 로그를 보장한다
    try {
      await ensureGuestGeneratedIndexes();
      const detected = await detectPassageSource(paragraph).catch(() => null);
      await saveGuestGeneratedQuestion({
        paragraph,
        type,
        difficulty,
        question_data: ai.question_data,
        detected,
        ip: ipHeader,
        userAgent,
        apiKeyHint,
      });
    } catch (e) {
      console.error('variant/generate guest-log:', e);
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
