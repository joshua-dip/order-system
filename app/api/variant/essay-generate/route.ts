import { NextRequest, NextResponse } from 'next/server';
import {
  generateEssayDraftWithClaude,
  isMemberEssayQuestionType,
} from '@/lib/member-essay-draft-claude';
import { detectPassageSource } from '@/lib/passage-source-detect';
import {
  ensureGuestGeneratedIndexes,
  saveGuestGeneratedQuestion,
} from '@/lib/guest-generated-questions-store';

export const maxDuration = 60;

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

  if (!paragraph || paragraph.length < 10) {
    return NextResponse.json({ error: '지문을 충분히 입력해 주세요.' }, { status: 400 });
  }
  if (!type || !isMemberEssayQuestionType(type)) {
    return NextResponse.json(
      { error: '유효한 서술형 문제 유형이 필요합니다.' },
      { status: 400 },
    );
  }

  const ipHeader =
    request.headers.get('x-forwarded-for') ||
    request.headers.get('x-real-ip') ||
    '';
  const userAgent = request.headers.get('user-agent') || '';
  const apiKeyHint = apiKeyHeader.slice(0, 12);

  try {
    const result = await generateEssayDraftWithClaude({
      paragraph,
      type,
      userHint: userHint || undefined,
      anthropicApiKey: apiKeyHeader,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 422 });
    }

    // Vercel Lambda는 return 즉시 함수가 종료되므로 응답 전에 await해서 로그를 보장한다
    try {
      await ensureGuestGeneratedIndexes();
      const detected = await detectPassageSource(paragraph).catch(() => null);
      await saveGuestGeneratedQuestion({
        paragraph,
        type,
        difficulty: '서술형',
        question_data: result.question_data as Record<string, unknown>,
        detected,
        ip: ipHeader,
        userAgent,
        apiKeyHint,
      });
    } catch (e) {
      console.error('variant/essay-generate guest-log:', e);
    }

    return NextResponse.json({ ok: true, type, question_data: result.question_data });
  } catch (e) {
    console.error('variant essay-generate:', e);
    return NextResponse.json({ error: '생성 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
