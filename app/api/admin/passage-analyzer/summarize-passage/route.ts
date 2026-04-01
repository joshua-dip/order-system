import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getPassageAnalyzerAnthropic } from '@/lib/passage-analyzer-claude';

export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const claude = getPassageAnalyzerAnthropic();
  if ('error' in claude) {
    return NextResponse.json({ error: claude.error }, { status: 503 });
  }
  const { anthropic, model } = claude;

  try {
    const { passage } = await request.json();
    if (!passage || typeof passage !== 'string') {
      return NextResponse.json({ error: '지문이 필요합니다.' }, { status: 400 });
    }

    const message = await anthropic.messages.create({
      model,
      max_tokens: 200,
      messages: [
        {
          role: 'user',
          content: `Summarize this text in one sentence (25-30 words, CEFR B2-C1). Include three keywords.

Text:
${passage}

Response:
Summary: [sentence]
Keywords: [three keywords]`,
        },
      ],
    });

    const response = message.content[0];
    if (response.type !== 'text') {
      return NextResponse.json({ summary: '', keywords: '' });
    }

    const text = response.text;
    const lines = text.split('\n').filter((line) => line.trim());
    let summary = '';
    let keywords = '';
    for (const line of lines) {
      if (line.includes('Summary:')) summary = line.replace(/^.*?:/, '').trim();
      else if (line.includes('Keywords:')) keywords = line.replace(/^.*?:/, '').trim();
    }
    if (!summary && lines.length > 0) summary = lines[0].replace(/^(Summary:|요약:)/, '').trim();

    return NextResponse.json({ summary, keywords });
  } catch (e) {
    console.error('summarize-passage:', e);
    return NextResponse.json({ error: '요약 실패' }, { status: 500 });
  }
}
