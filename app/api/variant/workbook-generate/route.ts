import { NextRequest, NextResponse } from 'next/server';
import { generateWorkbookGrammarQuestion } from '@/lib/workbook-grammar-claude';
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
  const maxPoints =
    typeof body.maxPoints === 'number' ? Math.min(6, Math.max(1, body.maxPoints)) : 4;

  if (!paragraph || paragraph.length < 10) {
    return NextResponse.json({ error: '지문을 충분히 입력해 주세요.' }, { status: 400 });
  }

  const ipHeader =
    request.headers.get('x-forwarded-for') ||
    request.headers.get('x-real-ip') ||
    '';
  const userAgent = request.headers.get('user-agent') || '';
  const apiKeyHint = apiKeyHeader.slice(0, 12);

  try {
    const result = await generateWorkbookGrammarQuestion({
      passage: paragraph,
      maxPoints,
      apiKey: apiKeyHeader,
    });

    try {
      await ensureGuestGeneratedIndexes();
      const detectWithTimeout = Promise.race([
        detectPassageSource(paragraph),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 8_000)),
      ]);
      const detected = await detectWithTimeout.catch(() => null);
      await saveGuestGeneratedQuestion({
        paragraph,
        type: '워크북어법',
        difficulty: '워크북',
        question_data: result.questionData as Record<string, unknown>,
        detected,
        ip: ipHeader,
        userAgent,
        apiKeyHint,
      });
    } catch (e) {
      console.error('variant/workbook-generate guest-log:', e);
    }

    return NextResponse.json({
      ok: true,
      type: '워크북어법',
      question_data: result.questionData,
      pointCount: result.questionData.GrammarPoints.length,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '생성 중 오류가 발생했습니다.';
    console.error('variant workbook-generate:', e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
