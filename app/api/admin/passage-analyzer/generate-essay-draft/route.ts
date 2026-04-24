import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import {
  generateEssayDraftWithClaude,
  isMemberEssayQuestionType,
} from '@/lib/member-essay-draft-claude';

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const apiKey = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY가 서버에 설정되어 있지 않습니다.' }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '요청 본문을 읽을 수 없습니다.' }, { status: 400 });
  }

  const { paragraph, type, focusSentences, userHint } = body as {
    paragraph?: string;
    type?: string;
    focusSentences?: string[];
    userHint?: string;
  };

  if (!paragraph || typeof paragraph !== 'string' || !paragraph.trim()) {
    return NextResponse.json({ error: 'paragraph(지문)이 필요합니다.' }, { status: 400 });
  }
  if (!type || !isMemberEssayQuestionType(type)) {
    return NextResponse.json({ error: `type이 올바르지 않습니다: ${type}` }, { status: 400 });
  }

  const result = await generateEssayDraftWithClaude({
    paragraph: paragraph.trim(),
    type,
    focusSentences: Array.isArray(focusSentences)
      ? focusSentences.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      : undefined,
    userHint: typeof userHint === 'string' && userHint.trim() ? userHint.trim() : undefined,
    anthropicApiKey: apiKey,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true, question_data: result.question_data });
}
