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
    const { koreanText } = await request.json();
    if (!koreanText || typeof koreanText !== 'string') {
      return NextResponse.json({ error: '한국어 텍스트가 필요합니다.' }, { status: 400 });
    }

    const message = await anthropic.messages.create({
      model,
      max_tokens: 150,
      messages: [
        {
          role: 'user',
          content: `다음 한국어를 자연스러운 영어로 번역하세요.\n\n${koreanText}\n\n영어 번역: [번역]`,
        },
      ],
    });

    const response = message.content[0];
    if (response.type !== 'text') {
      return NextResponse.json({ translation: '' });
    }
    const t = response.text;
    const m = t.match(/영어\s*번역\s*[:：]\s*(.+)/i);
    return NextResponse.json({ translation: m ? m[1].trim() : t.trim() });
  } catch (e) {
    console.error('translate-topic:', e);
    return NextResponse.json({ error: '번역 실패' }, { status: 500 });
  }
}
